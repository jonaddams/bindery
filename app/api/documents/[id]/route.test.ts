// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const findFirstDocument = vi.fn();
const updateDocument = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  getDocumentWriteFilter: () => ({ ownerId: 'user_jon' }),
  getEffectiveDocumentFilter: () => ({}),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      findFirst: (...a: unknown[]) => findFirstDocument(...a),
      update: (...a: unknown[]) => updateDocument(...a),
    },
  },
}));
vi.mock('@/lib/document-provider', () => ({ documentProvider: () => ({}) }));

const { PUT } = await import('@/app/api/documents/[id]/route');

const rename = (body: unknown) =>
  PUT(
    new Request('https://example.test/api/documents/doc_1', {
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }) as never,
    { params: Promise.resolve({ id: 'doc_1' }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ user: { id: 'user_jon' } });
  findFirstDocument.mockResolvedValue({ id: 'doc_1', title: 'Old', author: 'Jon' });
  updateDocument.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'doc_1',
    fileSize: BigInt(10),
    ...data,
  }));
});

const savedTitle = () => updateDocument.mock.calls[0][0].data.title;

describe('Renaming a document', () => {
  it('saves the new title', async () => {
    const response = await rename({ title: 'Q3 Contract — signed' });

    expect(response.status).toBe(200);
    expect(savedTitle()).toBe('Q3 Contract — signed');
  });

  it('trims stray spaces', async () => {
    await rename({ title: '  Q3 Contract  ' });

    expect(savedTitle()).toBe('Q3 Contract');
  });

  it('refuses a title that is only spaces', async () => {
    const response = await rename({ title: '   ' });

    expect(response.status).toBe(400);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('refuses a title too long to show, naming the limit', async () => {
    const response = await rename({ title: 'x'.repeat(201) });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('200');
  });

  it('refuses a title that is not text', async () => {
    expect((await rename({ title: 42 })).status).toBe(400);
  });

  it('refuses a body that is not JSON', async () => {
    expect((await rename('not json')).status).toBe(400);
  });

  // The write filter: an owner, or an admin acting as admin. A reader who was
  // only mentioned on the document cannot rename it.
  it('is not found for someone who may not edit the document', async () => {
    findFirstDocument.mockResolvedValue(null);

    expect((await rename({ title: 'Mine now' })).status).toBe(404);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('answers 401 when nobody is signed in', async () => {
    requireAuth.mockRejectedValue(new Error('Authentication required'));

    expect((await rename({ title: 'Anything' })).status).toBe(401);
  });
});
