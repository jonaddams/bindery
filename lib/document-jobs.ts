/**
 * The lifecycle of an asynchronous document operation.
 *
 * This module owns the state machine and nothing else: what a job is, how it is
 * claimed, and how it ends. `lib/job-runner.ts` owns *doing* the work, and the
 * split matters — the runner is meant to be replaceable (today `after()` plus a
 * cron sweep, tomorrow a real queue) and the state machine is not.
 *
 * ## Why claiming is a conditional update
 *
 * Two runners race for every job by design: the inline `after()` call that
 * follows the request, and the sweeper that exists to catch what `after()`
 * dropped. The claim therefore cannot be a read, a check and then a write —
 * both would read PENDING, both would pass the check, and both would run the
 * job. The work is a billed API call that creates a document, so a double-run
 * is visible and expensive rather than merely wasteful.
 *
 * `updateMany` with the expected status in the `where` clause pushes the check
 * into the database, where it is atomic: exactly one caller gets `count: 1`.
 * This is the same shape as the lesson in CLAUDE.md about putting a guessed code
 * in a SQL `WHERE` — there the effect was unwanted, here it is the entire point.
 */

import type { Redaction } from '@/lib/operations/redaction';
import { prisma } from '@/lib/prisma';

/**
 * How many times a job may be claimed before the sweeper stops picking it up.
 *
 * Bounds the cost of a job that fails every time — a corrupt source file, a
 * pattern the API rejects — which would otherwise be retried on every sweep
 * forever, billing an API call each time.
 */
export const MAX_JOB_ATTEMPTS = 3;

/**
 * How long a job may sit in RUNNING before it is presumed abandoned.
 *
 * Must exceed the longest a legitimate run can take, and a run is bounded by the
 * provider's request timeout (120s by default), not by anything here. Ten
 * minutes leaves generous headroom: reclaiming a job that is actually still
 * running is the one genuinely harmful mistake this number can make, since it
 * produces exactly the double-run the conditional claim exists to prevent.
 */
export const STALE_JOB_MINUTES = 10;

/** One sweep's worth of work, so a backlog cannot turn into one enormous run. */
const SWEEP_BATCH_SIZE = 10;

/**
 * Postgres will reject a string past the column width, and an API error body has
 * no length bound. Losing the entire failure record because the explanation was
 * too long would be a worse outcome than losing the tail of the explanation.
 */
const MAX_ERROR_LENGTH = 2_000;

const stalledBefore = (): Date => new Date(Date.now() - STALE_JOB_MINUTES * 60 * 1000);

/** Work a runner may take on: never started, or started and abandoned. */
const reclaimableStatuses = () => [
  { status: 'PENDING' as const },
  { status: 'RUNNING' as const, startedAt: { lt: stalledBefore() } },
];

export const createRedactionJob = async (options: {
  documentId: string;
  requestedById: string;
  redaction: Redaction;
}) => {
  const { documentId, requestedById, redaction } = options;

  return prisma.documentJob.create({
    data: {
      documentId,
      requestedById,
      kind: 'REDACTION',
      // Stored as given so a finished job can still answer "what did this
      // remove?". A status alone cannot, and for redaction that question is the
      // one a reader most needs answered.
      parameters: { ...redaction },
    },
  });
};

/**
 * Take ownership of a job, if it is still there to be taken.
 *
 * Returns the job on success and `undefined` when another runner won the race —
 * which is an ordinary outcome, not an error, and callers should simply stop.
 *
 * `reclaimStalled` widens the claim to jobs left RUNNING by a runner that died.
 * The sweeper passes it; the inline path does not, because a job it is being
 * asked to run has only just been created.
 */
export const claimJob = async (options: { jobId: string; reclaimStalled?: boolean }) => {
  const { jobId, reclaimStalled = false } = options;

  const claimed = await prisma.documentJob.updateMany({
    where: reclaimStalled
      ? { id: jobId, OR: reclaimableStatuses() }
      : { id: jobId, status: 'PENDING' },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (claimed.count !== 1) {
    return undefined;
  }

  return (await prisma.documentJob.findUnique({ where: { id: jobId } })) ?? undefined;
};

export const succeedJob = async (options: { jobId: string; outputDocumentId: string }) =>
  prisma.documentJob.update({
    where: { id: options.jobId },
    data: {
      status: 'SUCCEEDED',
      outputDocumentId: options.outputDocumentId,
      error: null,
      finishedAt: new Date(),
    },
  });

export const failJob = async (options: { jobId: string; error: string }) =>
  prisma.documentJob.update({
    where: { id: options.jobId },
    data: {
      status: 'FAILED',
      error: options.error.slice(0, MAX_ERROR_LENGTH),
      finishedAt: new Date(),
    },
  });

/**
 * What the sweeper should pick up: queued work, plus work abandoned mid-flight.
 *
 * Oldest first, so a backlog drains in the order it arrived rather than starving
 * whatever has been waiting longest.
 */
export const findReclaimableJobs = async () =>
  prisma.documentJob.findMany({
    where: {
      OR: reclaimableStatuses(),
      attempts: { lt: MAX_JOB_ATTEMPTS },
    },
    orderBy: { createdAt: 'asc' },
    take: SWEEP_BATCH_SIZE,
  });
