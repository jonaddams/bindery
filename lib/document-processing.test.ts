// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { documentProvider } from '@/lib/document-provider';

const pdfBytes = (): Uint8Array<ArrayBuffer> =>
  new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

const pdfResponse = (bytes: Uint8Array<ArrayBuffer> = pdfBytes()) =>
  new Response(new Blob([bytes]), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  });

const mockFetch = (...responses: readonly Response[]) => {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const lastCall = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.at(-1);
const sentUrl = (fetchMock: ReturnType<typeof vi.fn>) => String(lastCall(fetchMock)?.[0]);
const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>) =>
  lastCall(fetchMock)?.[1]?.headers as Record<string, string>;

beforeEach(() => {
  vi.stubEnv('NUTRIENT_VIEWER_API_KEY', 'viewer-key');
  vi.stubEnv('NUTRIENT_PROCESSOR_API_KEY', 'processor-key');
  vi.stubEnv('NUTRIENT_API_KEY', undefined);
  vi.stubEnv('NUTRIENT_TARGET', 'dws');
  vi.stubEnv('NUTRIENT_BASE_URL', 'https://api.nutrient.io');
  vi.stubEnv('NUTRIENT_API_BASE_URL', undefined);
  vi.stubEnv('NUTRIENT_API_BASE_URL_ROOT', undefined);
});

describe('downloading a document to work on', () => {
  it('reads the file back from the viewer API', async () => {
    const fetchMock = mockFetch(pdfResponse());

    const bytes = await documentProvider().downloadDocument({ documentId: 'doc_1' });

    // Undocumented, established by probing the live API: the bare document URL
    // and every other spelling tried answered 404; only /pdf returns the file.
    expect(sentUrl(fetchMock)).toBe('https://api.nutrient.io/viewer/documents/doc_1/pdf');
    expect(new Uint8Array(bytes)).toEqual(pdfBytes());
  });

  it('presents the viewer key, since downloading is a viewer operation', async () => {
    const fetchMock = mockFetch(pdfResponse());

    await documentProvider().downloadDocument({ documentId: 'doc_1' });

    expect(sentHeaders(fetchMock).Authorization).toBe('Bearer viewer-key');
  });

  it('reports a refusal rather than returning an empty document', async () => {
    mockFetch(new Response('gone', { status: 404 }));

    await expect(documentProvider().downloadDocument({ documentId: 'doc_1' })).rejects.toThrow(
      /404/
    );
  });
});

describe('processing a document', () => {
  const instructions = {
    parts: [{ file: 'document' }] as const,
    actions: [{ type: 'redaction', strategy: 'preset', preset: 'email-address' }] as const,
    output: { type: 'pdf' } as const,
  };

  it('posts to the build endpoint', async () => {
    const fetchMock = mockFetch(pdfResponse());

    await documentProvider().processDocument({
      source: pdfBytes(),
      filename: 'report.pdf',
      instructions,
    });

    expect(sentUrl(fetchMock)).toBe('https://api.nutrient.io/build');
    expect(lastCall(fetchMock)?.[1]?.method).toBe('POST');
  });

  // The whole point of splitting the keys. The viewer key answers 403 here.
  it('presents the processor key, not the viewer key', async () => {
    const fetchMock = mockFetch(pdfResponse());

    await documentProvider().processDocument({
      source: pdfBytes(),
      filename: 'report.pdf',
      instructions,
    });

    expect(sentHeaders(fetchMock).Authorization).toBe('Bearer processor-key');
  });

  it('sends the instructions and the file under the name the instructions reference', async () => {
    const fetchMock = mockFetch(pdfResponse());

    await documentProvider().processDocument({
      source: pdfBytes(),
      filename: 'report.pdf',
      instructions,
    });

    const body = lastCall(fetchMock)?.[1]?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(JSON.parse(String(body.get('instructions')))).toEqual(instructions);
    // `parts[0].file` is "document", so the field must be too, or the API
    // answers file_not_found.
    expect(body.get('document')).toBeInstanceOf(File);
  });

  it('returns the processed bytes', async () => {
    const processed = new Uint8Array([1, 2, 3, 4]);
    mockFetch(pdfResponse(processed));

    const result = await documentProvider().processDocument({
      source: pdfBytes(),
      filename: 'report.pdf',
      instructions,
    });

    expect(new Uint8Array(result)).toEqual(processed);
  });

  // The Processor API reports which field of the instructions was wrong. That
  // detail is the difference between a fixable job and an opaque failure, so it
  // must survive into the error rather than being flattened to the status code.
  it('carries the API’s own explanation into the error', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          error: {
            details: 'There was an error with one or more parts of the instructions.',
            failingPaths: [{ details: "can't be empty", path: '$.instructions.parts' }],
            status: 400,
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      documentProvider().processDocument({
        source: pdfBytes(),
        filename: 'report.pdf',
        instructions,
      })
    ).rejects.toThrow(/\$\.instructions\.parts/);
  });

  it('names a forbidden response as the likely wrong key, the one failure that recurs', async () => {
    mockFetch(new Response('Forbidden', { status: 403 }));

    await expect(
      documentProvider().processDocument({
        source: pdfBytes(),
        filename: 'report.pdf',
        instructions,
      })
    ).rejects.toThrow(/NUTRIENT_PROCESSOR_API_KEY/);
  });
});
