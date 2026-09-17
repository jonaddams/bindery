// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createJobRow = vi.fn();
const updateManyJobs = vi.fn();
const findUniqueJob = vi.fn();
const findManyJobs = vi.fn();
const updateJob = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    documentJob: {
      create: (...a: unknown[]) => createJobRow(...a),
      updateMany: (...a: unknown[]) => updateManyJobs(...a),
      findUnique: (...a: unknown[]) => findUniqueJob(...a),
      findMany: (...a: unknown[]) => findManyJobs(...a),
      update: (...a: unknown[]) => updateJob(...a),
    },
  },
}));

const {
  MAX_JOB_ATTEMPTS,
  STALE_JOB_MINUTES,
  claimJob,
  createDocumentJob,
  failJob,
  findReclaimableJobs,
  succeedJob,
} = await import('@/lib/document-jobs');

beforeEach(() => {
  vi.clearAllMocks();
  createJobRow.mockResolvedValue({ id: 'job_1' });
  updateManyJobs.mockResolvedValue({ count: 1 });
  findUniqueJob.mockResolvedValue({ id: 'job_1', status: 'RUNNING' });
  findManyJobs.mockResolvedValue([]);
  updateJob.mockResolvedValue({});
});

describe('queueing a job', () => {
  it('records what was asked for, so a finished job can still say what it did', async () => {
    await createDocumentJob({
      documentId: 'doc_1',
      requestedById: 'user_alice',
      kind: 'REDACTION',
      parameters: { strategy: 'preset', preset: 'social-security-number' },
    });

    expect(createJobRow).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentId: 'doc_1',
          requestedById: 'user_alice',
          kind: 'REDACTION',
          parameters: { strategy: 'preset', preset: 'social-security-number' },
        }),
      })
    );
  });

  it('starts pending, because nothing has run yet', async () => {
    await createDocumentJob({
      documentId: 'doc_1',
      requestedById: 'user_alice',
      kind: 'REDACTION',
      parameters: { strategy: 'preset', preset: 'email-address' },
    });

    const { data } = createJobRow.mock.calls[0][0];
    expect(data.status ?? 'PENDING').toBe('PENDING');
  });

  it('records the operation kind it was asked for', async () => {
    createJobRow.mockResolvedValue({ id: 'job_1' });

    await createDocumentJob({
      documentId: 'doc_1',
      requestedById: 'user_1',
      kind: 'OCR',
      parameters: { kind: 'OCR', language: 'english' },
    });

    expect(createJobRow).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'OCR' }),
      })
    );
  });
});

describe('claiming a job to run it', () => {
  // The whole correctness of the runner rests on this. Two runners race here by
  // design: the inline after() call and the sweeper. A read-then-write claim
  // would let both pass the check and both do the work — and the work is a
  // billed API call that creates a document, so a double-run is visible and
  // expensive, not merely wasteful.
  it('moves the job to running in one conditional update', async () => {
    await claimJob({ jobId: 'job_1' });

    expect(updateManyJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'job_1', status: 'PENDING' }),
        data: expect.objectContaining({ status: 'RUNNING' }),
      })
    );
  });

  it('returns the job when the claim took effect', async () => {
    updateManyJobs.mockResolvedValue({ count: 1 });

    const claimed = await claimJob({ jobId: 'job_1' });

    expect(claimed).toEqual({ id: 'job_1', status: 'RUNNING' });
  });

  it('returns nothing when another runner got there first', async () => {
    updateManyJobs.mockResolvedValue({ count: 0 });

    const claimed = await claimJob({ jobId: 'job_1' });

    expect(claimed).toBeUndefined();
    // No point reading a row we did not win.
    expect(findUniqueJob).not.toHaveBeenCalled();
  });

  it('counts the attempt, so a job that always fails cannot be retried forever', async () => {
    await claimJob({ jobId: 'job_1' });

    const { data } = updateManyJobs.mock.calls[0][0];
    expect(data.attempts).toEqual({ increment: 1 });
  });

  it('records when the run started, which is what makes a stalled job visible', async () => {
    await claimJob({ jobId: 'job_1' });

    const { data } = updateManyJobs.mock.calls[0][0];
    expect(data.startedAt).toBeInstanceOf(Date);
  });

  // A job left RUNNING by a crashed runner must be recoverable, or one crash
  // strands it forever.
  it('can reclaim a job left running by a dead runner', async () => {
    await claimJob({ jobId: 'job_1', reclaimStalled: true });

    const { where } = updateManyJobs.mock.calls[0][0];
    expect(where.OR).toEqual([
      { status: 'PENDING' },
      { status: 'RUNNING', startedAt: { lt: expect.any(Date) } },
    ]);
  });
});

describe('finishing a job', () => {
  it('records the document the work produced', async () => {
    await succeedJob({ jobId: 'job_1', outputDocumentId: 'doc_2' });

    expect(updateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job_1' },
        data: expect.objectContaining({ status: 'SUCCEEDED', outputDocumentId: 'doc_2' }),
      })
    );
  });

  it('stamps when it finished', async () => {
    await succeedJob({ jobId: 'job_1', outputDocumentId: 'doc_2' });

    expect(updateJob.mock.calls[0][0].data.finishedAt).toBeInstanceOf(Date);
  });

  it('keeps the reason a job failed', async () => {
    await failJob({ jobId: 'job_1', error: 'Processing failed: 402 - insufficient credits' });

    expect(updateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: 'Processing failed: 402 - insufficient credits',
        }),
      })
    );
  });

  // Postgres rejects a string past the column width, and an API error body can
  // be arbitrarily long. Losing the whole failure record to an oversized message
  // would be worse than losing the tail of the message.
  it('truncates an enormous error rather than failing to record the failure', async () => {
    await failJob({ jobId: 'job_1', error: 'x'.repeat(10_000) });

    expect(updateJob.mock.calls[0][0].data.error.length).toBeLessThan(2_100);
  });
});

describe('finding work the sweeper should pick up', () => {
  it('looks for pending jobs and for running jobs that have stalled', async () => {
    await findReclaimableJobs();

    const { where } = findManyJobs.mock.calls[0][0];
    expect(where.OR).toEqual([
      { status: 'PENDING' },
      { status: 'RUNNING', startedAt: { lt: expect.any(Date) } },
    ]);
  });

  it('leaves alone a job that has already been tried too often', async () => {
    await findReclaimableJobs();

    const { where } = findManyJobs.mock.calls[0][0];
    expect(where.attempts).toEqual({ lt: MAX_JOB_ATTEMPTS });
  });

  it('bounds how much one sweep will take on', async () => {
    await findReclaimableJobs();

    expect(findManyJobs.mock.calls[0][0].take).toBeGreaterThan(0);
  });

  it('agrees with claimJob about what counts as stalled', () => {
    expect(STALE_JOB_MINUTES).toBeGreaterThan(0);
  });
});
