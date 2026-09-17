/**
 * Doing the work a job describes, and deciding when.
 *
 * ## The runner is pluggable, and that is the point
 *
 * This is a reference implementation, not a queue. Two runners are provided and
 * neither is production infrastructure:
 *
 * - **`after()`** runs the job just after the response is sent, so the common
 *   case is fast and needs nothing deployed. It is not durable: if the function
 *   instance goes away mid-job, the work is simply lost.
 * - **the sweeper** is the durability backstop. A scheduled pass picks up jobs
 *   that were never started and jobs left RUNNING by a runner that died.
 *
 * Together they are *good enough and honest about it*. A real deployment should
 * replace `enqueue` with a queue that offers at-least-once delivery — Vercel
 * Queues, SQS, a database-backed worker — and the seam for doing so is the
 * `JobRunner` type. For an accelerator a **pluggable** runner beats a good one,
 * because the reader's own answer differs from ours and what they need is the
 * place to put it.
 *
 * ## Everything ends in a terminal state
 *
 * A job left RUNNING is indistinguishable from one still in flight, so every
 * path out of `runJob` either succeeds the job or fails it. The one exception is
 * losing the claim, which means another runner owns the job and this one must
 * not touch it.
 */

import type { DocumentJobKind } from '@prisma/client';
import { after } from 'next/server';
import { claimJob, failJob, findReclaimableJobs, succeedJob } from '@/lib/document-jobs';
import { documentProvider } from '@/lib/document-provider';
import { nutrientConfig } from '@/lib/nutrient-config';
import { operationsFor } from '@/lib/operations';
import { prisma } from '@/lib/prisma';

/**
 * How a job gets from "recorded" to "running".
 *
 * The only thing a caller needs, and the only thing a different deployment would
 * replace.
 */
export type JobRunner = {
  enqueue(options: { jobId: string }): void;
};

/** The multipart field name, and so also the name the instructions reference. */
const FILE_PART_NAME = 'document';

/**
 * Name the output so it cannot be mistaken for its source in a list.
 *
 * Worth doing properly: the whole hazard of an operation like redaction is
 * someone sending the wrong one of two near-identical documents.
 */
const suffixedTitle = (title: string, suffix: string): string => `${title} (${suffix})`;

const suffixedFilename = (filename: string, suffix: string): string => {
  const extension = filename.lastIndexOf('.');

  if (extension <= 0) {
    return `${filename}-${suffix}`;
  }

  return `${filename.slice(0, extension)}-${suffix}${filename.slice(extension)}`;
};

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Perform one job, from claim to terminal state.
 *
 * Safe to call for a job that is already finished or already claimed: the claim
 * fails and it returns without doing anything.
 */
export const runJob = async (options: {
  jobId: string;
  reclaimStalled?: boolean;
}): Promise<void> => {
  const { jobId, reclaimStalled = false } = options;

  const job = await claimJob({ jobId, reclaimStalled });

  if (!job) {
    // Another runner owns it. Not an error: this is the race the conditional
    // claim exists to settle, and losing it is the ordinary outcome.
    return;
  }

  try {
    await performJob(job);
  } catch (error) {
    // Deliberately not caught around failJob: if recording the failure itself
    // fails, that must surface rather than leaving the job silently RUNNING with
    // nobody aware. The sweeper will reclaim it once it goes stale.
    await failJob({ jobId, error: describe(error) });
  }
};

type ClaimedJob = {
  id: string;
  documentId: string;
  kind: DocumentJobKind;
  parameters: unknown;
};

const performJob = async (job: ClaimedJob): Promise<void> => {
  // Gated on the *configured* backend, not merely on whether the kind exists in
  // the registry: the route and the page both offer only what
  // `operationsFor(target)` returns, and a job queued while pointed at one
  // backend must not silently run against another that may not implement it at
  // all. This is inert while every operation lists both backends and stops
  // being inert the moment one does not.
  const target = nutrientConfig().target;
  const operation = operationsFor(target).find((candidate) => candidate.kind === job.kind);

  if (!operation) {
    // Parameters and kind are read back from the database, so nothing
    // guarantees the running code still implements what an older writer
    // recorded, or that the deployment is still pointed at the backend that
    // queued it — this is a real runtime case, not defensive padding.
    throw new Error(
      `This job cannot be run: "${job.kind}" is not an operation the "${target}" backend performs.`
    );
  }

  const request = operation.parse(job.parameters);

  if (!request.ok) {
    // Parameters are read back from JSON, so nothing guarantees they still
    // describe an operation this code can perform — the column is Json, and the
    // code that wrote it may be older than the code reading it.
    throw new Error(`This job cannot be run: ${request.message}`);
  }

  const document = await prisma.document.findUnique({ where: { id: job.documentId } });

  if (!document) {
    throw new Error('The document this job was queued for no longer exists.');
  }

  const provider = documentProvider();

  const source = await provider.downloadDocument({ documentId: document.documentEngineId });

  const processed = await provider.processDocument({
    source: new Uint8Array(source),
    filename: document.filename,
    instructions: request.buildInstructions({ filePartName: FILE_PART_NAME }),
  });

  const filename = suffixedFilename(document.filename, request.outputSuffix);

  const uploaded = await provider.uploadDocument({
    file: new File([processed], filename, { type: 'application/pdf' }),
  });

  const output = await prisma.document.create({
    data: {
      documentEngineId: uploaded.documentId,
      sessionToken: uploaded.sessionToken,
      title: suffixedTitle(document.title, request.outputSuffix),
      filename,
      // Always a PDF regardless of what went in: the Build output is `pdf`, so
      // carrying the source's type across would mislabel a redacted .docx.
      fileType: 'application/pdf',
      fileSize: BigInt(processed.byteLength),
      author: document.author,
      // The owner of the original, NOT whoever requested the job. An admin
      // redacting someone else's document must not quietly take ownership of the
      // result, which would hide it from the person whose document it is.
      ownerId: document.ownerId,
      derivedFromId: document.id,
    },
  });

  await succeedJob({ jobId: job.id, outputDocumentId: output.id });
};

/**
 * The default runner: run the job once the response is on its way.
 *
 * `after()` keeps the work off the request's critical path without needing any
 * infrastructure. It is explicitly not durable — see the note at the top of this
 * file — which is what the sweeper is for.
 */
export const afterResponseRunner: JobRunner = {
  enqueue({ jobId }) {
    after(async () => {
      try {
        await runJob({ jobId });
      } catch {
        // Nothing useful can be done with a throw here: the response has already
        // been sent. The job is left for the sweeper, which is precisely the
        // case the sweeper exists for.
      }
    });
  },
};

/** The runner this deployment uses. One call site, so it is easy to replace. */
export const jobRunner = (): JobRunner => afterResponseRunner;

/**
 * Take on whatever work is outstanding.
 *
 * Called on a schedule. Every job is attempted independently: one failure must
 * not abandon the rest of the batch, or a single bad job blocks the queue for as
 * long as it keeps failing.
 */
export const sweepJobs = async (): Promise<{ considered: number }> => {
  const jobs = await findReclaimableJobs();

  for (const job of jobs) {
    try {
      await runJob({ jobId: job.id, reclaimStalled: true });
    } catch {
      // Already recorded against the job by runJob where it could be. Continue.
    }
  }

  return { considered: jobs.length };
};
