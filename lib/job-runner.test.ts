// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const claimJob = vi.fn();
const succeedJob = vi.fn();
const failJob = vi.fn();
const findReclaimableJobs = vi.fn();

vi.mock('@/lib/document-jobs', async () => {
  const actual = await vi.importActual<typeof import('@/lib/document-jobs')>('@/lib/document-jobs');
  return {
    ...actual,
    claimJob: (...a: unknown[]) => claimJob(...a),
    succeedJob: (...a: unknown[]) => succeedJob(...a),
    failJob: (...a: unknown[]) => failJob(...a),
    findReclaimableJobs: (...a: unknown[]) => findReclaimableJobs(...a),
  };
});

const operationFor = vi.fn();

vi.mock('@/lib/operations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/operations')>('@/lib/operations');
  return { ...actual, operationFor: (...a: unknown[]) => operationFor(...a) };
});

// The real lookup, used as the default so every test other than the one below
// exercises registry behaviour unchanged.
const { operationFor: realOperationFor } =
  await vi.importActual<typeof import('@/lib/operations')>('@/lib/operations');

const findUniqueDocument = vi.fn();
const createDocument = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      findUnique: (...a: unknown[]) => findUniqueDocument(...a),
      create: (...a: unknown[]) => createDocument(...a),
    },
  },
}));

const downloadDocument = vi.fn();
const processDocument = vi.fn();
const uploadDocument = vi.fn();

vi.mock('@/lib/document-provider', () => ({
  documentProvider: () => ({
    target: 'dws',
    downloadDocument: (...a: unknown[]) => downloadDocument(...a),
    processDocument: (...a: unknown[]) => processDocument(...a),
    uploadDocument: (...a: unknown[]) => uploadDocument(...a),
  }),
}));

const { runJob, sweepJobs } = await import('@/lib/job-runner');

const sourceBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
const processedBytes = new Uint8Array([9, 9, 9, 9]).buffer;

const aJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job_1',
  documentId: 'doc_1',
  kind: 'REDACTION',
  status: 'RUNNING',
  parameters: { strategy: 'preset', preset: 'social-security-number' },
  requestedById: 'user_alice',
  attempts: 1,
  ...overrides,
});

const aDocument = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc_1',
  documentEngineId: 'dws_1',
  title: 'Q3 Board Pack',
  filename: 'q3-board-pack.pdf',
  fileType: 'application/pdf',
  ownerId: 'user_owner',
  author: 'Alice',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  claimJob.mockResolvedValue(aJob());
  succeedJob.mockResolvedValue({});
  failJob.mockResolvedValue({});
  findReclaimableJobs.mockResolvedValue([]);
  operationFor.mockImplementation(realOperationFor);
  findUniqueDocument.mockResolvedValue(aDocument());
  createDocument.mockResolvedValue({ id: 'doc_2' });
  downloadDocument.mockResolvedValue(sourceBytes);
  processDocument.mockResolvedValue(processedBytes);
  uploadDocument.mockResolvedValue({ documentId: 'dws_2', sessionToken: 'jwt_2' });
});

describe('running a redaction job', () => {
  it('asks the processor for the redaction the job described', async () => {
    await runJob({ jobId: 'job_1' });

    const { instructions } = processDocument.mock.calls[0][0];
    expect(instructions.actions).toEqual([
      {
        type: 'createRedactions',
        strategy: 'preset',
        strategyOptions: { preset: 'social-security-number' },
      },
      { type: 'applyRedactions' },
    ]);
  });

  it('works on the bytes of the document the job names', async () => {
    await runJob({ jobId: 'job_1' });

    expect(downloadDocument).toHaveBeenCalledWith({ documentId: 'dws_1' });
  });

  it('stores the result as a new document rather than replacing the original', async () => {
    await runJob({ jobId: 'job_1' });

    expect(uploadDocument).toHaveBeenCalled();
    const { data } = createDocument.mock.calls[0][0];
    expect(data.documentEngineId).toBe('dws_2');
    expect(data.derivedFromId).toBe('doc_1');
  });

  it('gives the copy to whoever owned the original, not to whoever ran the job', async () => {
    claimJob.mockResolvedValue(aJob({ requestedById: 'user_admin' }));

    await runJob({ jobId: 'job_1' });

    // An admin redacting someone else's document must not quietly take ownership
    // of the result, which would hide it from the person whose document it is.
    expect(createDocument.mock.calls[0][0].data.ownerId).toBe('user_owner');
  });

  it('names the copy so it cannot be confused with the original in a list', async () => {
    await runJob({ jobId: 'job_1' });

    const { data } = createDocument.mock.calls[0][0];
    expect(data.title).toContain('Q3 Board Pack');
    expect(data.title).toMatch(/redacted/i);
    expect(data.filename).toMatch(/redacted/i);
  });

  it('marks the job succeeded against the document it produced', async () => {
    await runJob({ jobId: 'job_1' });

    expect(succeedJob).toHaveBeenCalledWith({ jobId: 'job_1', outputDocumentId: 'doc_2' });
  });
});

describe('when a job cannot be run', () => {
  it('does nothing at all if another runner already claimed it', async () => {
    claimJob.mockResolvedValue(undefined);

    await runJob({ jobId: 'job_1' });

    expect(downloadDocument).not.toHaveBeenCalled();
    expect(failJob).not.toHaveBeenCalled();
    expect(succeedJob).not.toHaveBeenCalled();
  });

  it('records why processing failed, in the API’s own words', async () => {
    processDocument.mockRejectedValue(new Error('Processing failed: 402 - out of credits'));

    await runJob({ jobId: 'job_1' });

    expect(failJob).toHaveBeenCalledWith({
      jobId: 'job_1',
      error: expect.stringContaining('402'),
    });
  });

  // A job left RUNNING is indistinguishable from one still in flight, so every
  // failure has to land somewhere rather than escaping.
  it('does not leave the job running when the download fails', async () => {
    downloadDocument.mockRejectedValue(new Error('Document download failed: 404 - gone'));

    await runJob({ jobId: 'job_1' });

    expect(failJob).toHaveBeenCalled();
  });

  it('fails the job when its document has been deleted underneath it', async () => {
    findUniqueDocument.mockResolvedValue(null);

    await runJob({ jobId: 'job_1' });

    expect(failJob).toHaveBeenCalledWith({
      jobId: 'job_1',
      error: expect.stringMatching(/no longer exists|not found/i),
    });
  });

  // Stored parameters are read back from JSON, so nothing guarantees they still
  // describe a redaction this code can perform.
  it('fails the job when its stored parameters are not a redaction it can run', async () => {
    claimJob.mockResolvedValue(aJob({ parameters: { strategy: 'telepathy' } }));

    await runJob({ jobId: 'job_1' });

    expect(failJob).toHaveBeenCalled();
    expect(processDocument).not.toHaveBeenCalled();
  });

  it('does not swallow the failure of recording a failure', async () => {
    processDocument.mockRejectedValue(new Error('boom'));
    failJob.mockRejectedValue(new Error('database unreachable'));

    await expect(runJob({ jobId: 'job_1' })).rejects.toThrow(/database unreachable/);
  });
});

describe('when a job kind has no operation', () => {
  it('refuses a job whose kind no operation implements, naming the kind', async () => {
    // The registry is complete today (every DocumentJobKind has an operation),
    // so there is no real unregistered kind left to use as a fixture. The
    // lookup miss is mocked instead of fabricated with `as DocumentJobKind` —
    // that would assert a bad value is a valid kind, which is exactly the
    // unjustified assertion this codebase forbids. What's under test is the
    // `if (!operation)` branch in job-runner.ts, not which kind caused it.
    operationFor.mockReturnValueOnce(undefined);
    claimJob.mockResolvedValue(aJob({ kind: 'REDACTION' }));

    await runJob({ jobId: 'job_1' });

    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('REDACTION') })
    );
  });
});

describe('sweeping for work', () => {
  it('runs everything it finds', async () => {
    findReclaimableJobs.mockResolvedValue([{ id: 'job_1' }, { id: 'job_2' }]);
    claimJob.mockResolvedValue(undefined);

    const swept = await sweepJobs();

    expect(claimJob).toHaveBeenCalledTimes(2);
    expect(swept.considered).toBe(2);
  });

  // The sweeper is the backstop for a runner that died mid-job, so it has to be
  // allowed to take a job back off RUNNING. The inline path must not.
  it('is allowed to reclaim jobs abandoned by a dead runner', async () => {
    findReclaimableJobs.mockResolvedValue([{ id: 'job_1' }]);
    claimJob.mockResolvedValue(undefined);

    await sweepJobs();

    expect(claimJob).toHaveBeenCalledWith({ jobId: 'job_1', reclaimStalled: true });
  });

  it('keeps going when one job throws, so one bad job cannot block the queue', async () => {
    findReclaimableJobs.mockResolvedValue([{ id: 'job_1' }, { id: 'job_2' }]);
    claimJob.mockRejectedValueOnce(new Error('database blip'));
    claimJob.mockResolvedValue(undefined);

    const swept = await sweepJobs();

    expect(swept.considered).toBe(2);
    expect(claimJob).toHaveBeenCalledTimes(2);
  });
});
