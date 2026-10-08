// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const findFirstDocument = vi.fn();
const findFirstJob = vi.fn();
const createDocumentJob = vi.fn();
const enqueue = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  getDocumentWriteFilter: () => ({ ownerId: 'user_jon' }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: { findFirst: (...a: unknown[]) => findFirstDocument(...a) },
    documentJob: { findFirst: (...a: unknown[]) => findFirstJob(...a) },
  },
}));
vi.mock('@/lib/document-jobs', () => ({
  createDocumentJob: (...a: unknown[]) => createDocumentJob(...a),
}));
vi.mock('@/lib/job-runner', () => ({
  jobRunner: () => ({ enqueue: (...a: unknown[]) => enqueue(...a) }),
}));
vi.mock('@/lib/nutrient-config', () => ({ nutrientConfig: () => ({ target: 'dws' }) }));

const { POST } = await import('@/app/api/documents/[id]/jobs/[jobId]/retry/route');

const retry = () =>
  POST(new Request('https://example.test/retry', { method: 'POST' }) as never, {
    params: Promise.resolve({ id: 'doc_1', jobId: 'job_1' }),
  });

const aFailedJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job_1',
  kind: 'REDACTION',
  status: 'FAILED',
  parameters: { strategy: 'preset', preset: 'email-address' },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ user: { id: 'user_jon' } });
  findFirstDocument.mockResolvedValue({
    id: 'doc_1',
    fileType: 'application/pdf',
    producedByJob: null,
  });
  findFirstJob.mockResolvedValue(aFailedJob());
  createDocumentJob.mockResolvedValue({
    id: 'job_2',
    kind: 'REDACTION',
    status: 'PENDING',
    parameters: { strategy: 'preset', preset: 'email-address' },
  });
});

describe('Retrying a failed job', () => {
  // A new job rather than resetting the old one, so history keeps both attempts.
  it('queues the same tool with the same settings as a new job', async () => {
    const response = await retry();

    expect(response.status).toBe(202);
    expect(createDocumentJob).toHaveBeenCalledWith({
      documentId: 'doc_1',
      requestedById: 'user_jon',
      kind: 'REDACTION',
      parameters: { strategy: 'preset', preset: 'email-address' },
    });
    expect(enqueue).toHaveBeenCalledWith({ jobId: 'job_2' });
  });

  it('returns the new job described, without its stored parameters', async () => {
    const { job } = await (await retry()).json();

    expect(job.description).toBe('Redact · Email addresses');
    expect(job).not.toHaveProperty('parameters');
  });

  it('only retries a job that failed', async () => {
    findFirstJob.mockResolvedValue(aFailedJob({ status: 'SUCCEEDED' }));

    expect((await retry()).status).toBe(409);
    expect(createDocumentJob).not.toHaveBeenCalled();
  });

  it('looks for the job only on this document', async () => {
    findFirstJob.mockResolvedValue(null);

    expect((await retry()).status).toBe(404);
    expect(findFirstJob).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'job_1', documentId: 'doc_1' } })
    );
  });

  // Retrying spends credits, exactly as starting did.
  it('requires write access to the document', async () => {
    findFirstDocument.mockResolvedValue(null);

    expect((await retry()).status).toBe(404);
    expect(createDocumentJob).not.toHaveBeenCalled();
  });

  it('refuses on a password-protected copy, saying why', async () => {
    findFirstDocument.mockResolvedValue({
      id: 'doc_1',
      fileType: 'application/pdf',
      producedByJob: { kind: 'PROTECT' },
    });

    const response = await retry();

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/password-protected/i);
  });

  // e.g. a protect job whose sealed password the server can no longer open.
  it('refuses settings that no longer describe a job it can run, saying why', async () => {
    findFirstJob.mockResolvedValue(aFailedJob({ parameters: { strategy: 'gone' } }));

    const response = await retry();

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeTruthy();
    expect(createDocumentJob).not.toHaveBeenCalled();
  });

  it('answers 401 when nobody is signed in', async () => {
    requireAuth.mockRejectedValue(new Error('Authentication required'));

    expect((await retry()).status).toBe(401);
  });
});
