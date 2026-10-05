// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const createDocument = vi.fn();
const uploadDocument = vi.fn();
const getBlob = vi.fn();
const deleteBlob = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  getEffectiveDocumentFilter: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { document: { create: (...a: unknown[]) => createDocument(...a) } },
}));
vi.mock('@/lib/document-provider', () => ({
  documentProvider: () => ({ uploadDocument: (...a: unknown[]) => uploadDocument(...a) }),
}));
vi.mock('@/lib/nutrient-config', () => ({
  nutrientConfig: () => ({
    limits: { maxUploadBytes: 100 * 1024 * 1024, allowedMimeTypes: ['application/pdf'] },
  }),
}));
vi.mock('@vercel/blob', () => ({
  get: (...a: unknown[]) => getBlob(...a),
  del: (...a: unknown[]) => deleteBlob(...a),
}));

const { POST } = await import('@/app/api/documents/route');

const OWN_STAGED_PATHNAME = 'uploads/user_jon/Invoice Lumen-a1b2.pdf';

const post = (body: unknown) =>
  POST(
    new Request('https://example.test/api/documents', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }) as never
  );

const anUpload = (overrides: Record<string, unknown> = {}) => ({
  pathname: OWN_STAGED_PATHNAME,
  filename: 'Invoice Lumen.pdf',
  title: 'Invoice Lumen',
  author: '',
  ...overrides,
});

const aStagedBlob = (options: { bytes?: string; contentType?: string } = {}) => {
  const { bytes = '%PDF-1.7 fake', contentType = 'application/pdf' } = options;
  return {
    statusCode: 200,
    stream: new Response(bytes).body,
    headers: new Headers(),
    blob: { pathname: OWN_STAGED_PATHNAME, contentType, size: bytes.length },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({
    user: { id: 'user_jon', name: 'Jon', email: 'jon@nutrient.io', role: 'USER' },
  });
  getBlob.mockResolvedValue(aStagedBlob());
  deleteBlob.mockResolvedValue(undefined);
  uploadDocument.mockResolvedValue({ documentId: 'dws_1', sessionToken: 'jwt_1' });
  createDocument.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'doc_1',
    ...data,
  }));
});

describe('Uploading a document staged in Blob storage', () => {
  it('sends the staged file to the document backend and records it', async () => {
    const response = await post(anUpload());

    expect(response.status).toBe(201);
    const [{ file }] = uploadDocument.mock.calls[0];
    expect(file.name).toBe('Invoice Lumen.pdf');
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('%PDF-1.7 fake');
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentEngineId: 'dws_1',
          title: 'Invoice Lumen',
          filename: 'Invoice Lumen.pdf',
          ownerId: 'user_jon',
        }),
      })
    );
  });

  it('reads the staged file privately, by pathname', async () => {
    await post(anUpload());

    expect(getBlob).toHaveBeenCalledWith(OWN_STAGED_PATHNAME, { access: 'private' });
  });

  it('removes the staged copy once the backend holds the document', async () => {
    await post(anUpload());

    expect(deleteBlob).toHaveBeenCalledWith(OWN_STAGED_PATHNAME);
  });

  it('still succeeds when removing the staged copy fails', async () => {
    deleteBlob.mockRejectedValue(new Error('blob service unavailable'));

    const response = await post(anUpload());

    expect(response.status).toBe(201);
  });

  it.each([
    ['another user’s upload', 'uploads/user_someone_else/secret.pdf'],
    ['a path that climbs out of the uploader’s own folder', 'uploads/user_jon/../user_x/a.pdf'],
    ['a full URL rather than a pathname', 'https://attacker.example/uploads/user_jon/a.pdf'],
    ['a path outside the uploads area', 'documents/a.pdf'],
  ])('refuses %s without reading it', async (_label, pathname) => {
    const response = await post(anUpload({ pathname }));

    expect(response.status).toBe(403);
    expect(getBlob).not.toHaveBeenCalled();
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('answers 404 when the staged file does not exist', async () => {
    getBlob.mockResolvedValue(null);

    const response = await post(anUpload());

    expect(response.status).toBe(404);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('refuses an unsupported file type and discards the staged copy', async () => {
    getBlob.mockResolvedValue(aStagedBlob({ contentType: 'application/x-msdownload' }));

    const response = await post(anUpload());

    expect(response.status).toBe(415);
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(deleteBlob).toHaveBeenCalledWith(OWN_STAGED_PATHNAME);
  });

  it('requires a title', async () => {
    const response = await post(anUpload({ title: '' }));

    expect(response.status).toBe(400);
    expect(getBlob).not.toHaveBeenCalled();
  });

  it('requires a staged pathname', async () => {
    const response = await post(anUpload({ pathname: undefined }));

    expect(response.status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    requireAuth.mockRejectedValue(new Error('Authentication required'));

    const response = await post(anUpload());

    expect(response.status).toBe(401);
  });
});
