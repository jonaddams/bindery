// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const findFirstDocument = vi.fn();
const streamDocument = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  getEffectiveDocumentFilter: () => ({ ownerId: 'user_jon' }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { document: { findFirst: (...a: unknown[]) => findFirstDocument(...a) } },
}));
vi.mock('@/lib/document-provider', () => ({
  documentProvider: () => ({ streamDocument: (...a: unknown[]) => streamDocument(...a) }),
}));

const { GET } = await import('@/app/api/documents/[id]/download/route');

const download = () =>
  GET(new Request('https://example.test/download') as never, {
    params: Promise.resolve({ id: 'doc_1' }),
  });

const stored = (contentType: string) => ({
  body: new Response(new Uint8Array([1, 2, 3])).body,
  contentType,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ user: { id: 'user_jon' } });
  findFirstDocument.mockResolvedValue({
    documentEngineId: 'dws_1',
    filename: 'Q3 Contract.pdf',
    fileType: 'application/pdf',
    producedByJob: null,
  });
  streamDocument.mockResolvedValue(stored('application/pdf'));
});

describe('Downloading a document', () => {
  it('sends the stored file as an attachment under its own name', async () => {
    const response = await download();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    expect(response.headers.get('Content-Disposition')).toContain(
      "filename*=UTF-8''Q3%20Contract.pdf"
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(streamDocument).toHaveBeenCalledWith({ documentId: 'dws_1' });
  });

  // DWS answers with a PDF rendering of an Office upload; naming it .docx would
  // hand someone a file their word processor cannot open.
  it('names the file for what the backend actually sent', async () => {
    findFirstDocument.mockResolvedValue({
      documentEngineId: 'dws_1',
      filename: 'minutes.docx',
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      producedByJob: null,
    });

    const response = await download();

    expect(response.headers.get('Content-Disposition')).toContain("filename*=UTF-8''minutes.pdf");
  });

  it('is not found when the reader may not see the document', async () => {
    findFirstDocument.mockResolvedValue(null);

    expect((await download()).status).toBe(404);
    expect(streamDocument).not.toHaveBeenCalled();
  });

  it('refuses a password-protected copy, saying how to get it instead', async () => {
    findFirstDocument.mockResolvedValue({
      documentEngineId: 'dws_1',
      filename: 'q3-protected.pdf',
      fileType: 'application/pdf',
      producedByJob: { kind: 'PROTECT' },
    });

    const response = await download();

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/viewer/i);
  });

  it('answers 401 when nobody is signed in', async () => {
    requireAuth.mockRejectedValue(new Error('Authentication required'));

    expect((await download()).status).toBe(401);
  });
});
