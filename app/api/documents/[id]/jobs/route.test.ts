// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const getDocumentWriteFilter = vi.fn();
const getEffectiveDocumentFilter = vi.fn();
const findFirstDocument = vi.fn();
const findManyJobs = vi.fn();
const createRedactionJob = vi.fn();
const enqueue = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  getDocumentWriteFilter: (...a: unknown[]) => getDocumentWriteFilter(...a),
  getEffectiveDocumentFilter: (...a: unknown[]) => getEffectiveDocumentFilter(...a),
}));
vi.mock('@/lib/document-jobs', () => ({
  createRedactionJob: (...a: unknown[]) => createRedactionJob(...a),
}));
vi.mock('@/lib/job-runner', () => ({
  jobRunner: () => ({ enqueue: (...a: unknown[]) => enqueue(...a) }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: { findFirst: (...a: unknown[]) => findFirstDocument(...a) },
    documentJob: { findMany: (...a: unknown[]) => findManyJobs(...a) },
  },
}));

const { GET, POST } = await import('@/app/api/documents/[id]/jobs/route');

const post = (body: unknown) =>
  POST(
    new Request('https://example.test/jobs', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }) as never,
    { params: Promise.resolve({ id: 'doc_1' }) }
  );

const get = () =>
  GET(new Request('https://example.test/jobs') as never, {
    params: Promise.resolve({ id: 'doc_1' }),
  });

const aRedaction = { kind: 'REDACTION', strategy: 'preset', preset: 'social-security-number' };

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({
    user: { id: 'user_jon', name: 'Jon', email: 'jon@nutrient.io', role: 'USER' },
  });
  getDocumentWriteFilter.mockReturnValue({ ownerId: 'user_jon' });
  getEffectiveDocumentFilter.mockReturnValue({});
  findFirstDocument.mockResolvedValue({ id: 'doc_1', title: 'Board Pack' });
  findManyJobs.mockResolvedValue([]);
  createRedactionJob.mockResolvedValue({
    id: 'job_1',
    status: 'PENDING',
    kind: 'REDACTION',
    createdAt: new Date('2026-09-14T12:00:00Z'),
  });
});

describe('Queueing a redaction', () => {
  it('records the job and reports it as accepted, not finished', async () => {
    const response = await post(aRedaction);

    // 202: the work has been taken on, not done. A 201 would imply the redacted
    // document already exists.
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(
      expect.objectContaining({ job: expect.objectContaining({ id: 'job_1' }) })
    );
  });

  it('hands the job to the runner', async () => {
    await post(aRedaction);

    expect(enqueue).toHaveBeenCalledWith({ jobId: 'job_1' });
  });

  it('records who asked for it', async () => {
    await post(aRedaction);

    expect(createRedactionJob).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc_1', requestedById: 'user_jon' })
    );
  });

  // Not the read filter. A redaction does not modify its source, so the read
  // filter is tempting — but it spends the owner's credits and creates a
  // document owned by them. Someone who can only read a document because they
  // were mentioned in a comment must not be able to do that.
  it('requires write access, not merely the ability to read the document', async () => {
    await post(aRedaction);

    expect(getDocumentWriteFilter).toHaveBeenCalled();
    expect(findFirstDocument.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ ownerId: 'user_jon' })
    );
  });

  it('is not found when the caller may not write to the document', async () => {
    findFirstDocument.mockResolvedValue(null);

    const response = await post(aRedaction);

    expect(response.status).toBe(404);
    expect(createRedactionJob).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('refuses an unknown preset without queueing anything', async () => {
    const response = await post({ kind: 'REDACTION', strategy: 'preset', preset: 'star-sign' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: expect.stringContaining('star-sign') })
    );
    expect(createRedactionJob).not.toHaveBeenCalled();
  });

  it('refuses an operation it does not perform', async () => {
    const response = await post({ kind: 'TRANSLATION', strategy: 'preset', preset: 'date' });

    expect(response.status).toBe(400);
    expect(createRedactionJob).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON at all', async () => {
    const response = await POST(
      new Request('https://example.test/jobs', { method: 'POST', body: 'not json' }) as never,
      { params: Promise.resolve({ id: 'doc_1' }) }
    );

    expect(response.status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    requireAuth.mockRejectedValue(new Error('Authentication required'));

    expect((await post(aRedaction)).status).toBe(401);
  });

  // A job that was recorded but never enqueued is not lost — the sweeper finds
  // it — so a runner that throws must not turn into a 500 that tells the caller
  // nothing happened.
  it('still reports success when the job was recorded but the runner threw', async () => {
    enqueue.mockImplementation(() => {
      throw new Error('after() unavailable');
    });

    expect((await post(aRedaction)).status).toBe(202);
  });
});

describe('Listing the jobs for a document', () => {
  it('reports what has been asked of this document', async () => {
    findManyJobs.mockResolvedValue([
      { id: 'job_1', status: 'SUCCEEDED', kind: 'REDACTION', outputDocumentId: 'doc_2' },
    ]);

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ jobs: [expect.objectContaining({ id: 'job_1' })] })
    );
  });

  // Reading the status of a job is not the same privilege as starting one:
  // anyone who can open the document can see what has been done to it.
  it('needs only read access', async () => {
    await get();

    expect(getEffectiveDocumentFilter).toHaveBeenCalled();
  });

  it('is not found when the caller cannot see the document', async () => {
    findFirstDocument.mockResolvedValue(null);

    expect((await get()).status).toBe(404);
    expect(findManyJobs).not.toHaveBeenCalled();
  });

  it('answers 401 when nobody is signed in', async () => {
    requireAuth.mockRejectedValue(new Error('Authentication required'));

    expect((await get()).status).toBe(401);
  });
});
