// @vitest-environment node

import { generateKeyPairSync } from 'node:crypto';
import { verify } from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { documentProvider } from '@/lib/document-provider';

const sessionResponse = () =>
  new Response(JSON.stringify({ jwt: 'a.viewer.jwt' }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

const uploadResponse = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
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

const sentBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(String(lastCall(fetchMock)?.[1]?.body));

const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>) =>
  lastCall(fetchMock)?.[1]?.headers as Record<string, string>;

beforeEach(() => {
  vi.stubEnv('NUTRIENT_API_KEY', 'test-api-key');
  vi.stubEnv('NUTRIENT_TARGET', 'dws');
  vi.stubEnv('NUTRIENT_BASE_URL', 'https://api.nutrient.io');
  vi.stubEnv('NUTRIENT_API_BASE_URL', undefined);
  vi.stubEnv('NUTRIENT_API_BASE_URL_ROOT', undefined);
});

describe('viewer session creation', () => {
  it('grants write access so the reader can add comments', async () => {
    const fetchMock = mockFetch(sessionResponse());

    await documentProvider().createViewerSession({ documentId: 'doc_1', userId: 'user_alice' });

    expect(sentBody(fetchMock).allowed_documents[0].permissions).toEqual(['read', 'write']);
  });

  it('uses the permissions key that DWS actually reads', async () => {
    const fetchMock = mockFetch(sessionResponse());

    await documentProvider().createViewerSession({ documentId: 'doc_1', userId: 'user_alice' });

    // DWS accepts `document_permissions` without complaint and then ignores it,
    // so sending the wrong key fails silently rather than erroring.
    expect(sentBody(fetchMock).allowed_documents[0]).not.toHaveProperty('document_permissions');
  });

  it('identifies the signed-in user so DWS attributes their comments', async () => {
    const fetchMock = mockFetch(sessionResponse());

    await documentProvider().createViewerSession({ documentId: 'doc_1', userId: 'user_alice' });

    expect(sentBody(fetchMock).user_id).toBe('user_alice');
  });

  it('omits the user when none is known, rather than sending an empty one', async () => {
    const fetchMock = mockFetch(sessionResponse());

    await documentProvider().createViewerSession({ documentId: 'doc_1' });

    expect(sentBody(fetchMock)).not.toHaveProperty('user_id');
  });

  it('asks for JSON explicitly, because DWS rejects a wildcard Accept header', async () => {
    const fetchMock = mockFetch(sessionResponse());

    await documentProvider().createViewerSession({ documentId: 'doc_1' });

    expect(sentHeaders(fetchMock).Accept).toBe('application/json');
  });

  it('returns the issued token', async () => {
    mockFetch(sessionResponse());

    const session = await documentProvider().createViewerSession({ documentId: 'doc_1' });

    expect(session).toEqual({ sessionToken: 'a.viewer.jwt', documentId: 'doc_1' });
  });

  it('reports a refused session rather than returning an empty token', async () => {
    mockFetch(new Response('nope', { status: 403 }));

    await expect(documentProvider().createViewerSession({ documentId: 'doc_1' })).rejects.toThrow(
      /403/
    );
  });
});

describe('where the backend lives', () => {
  it('asks the configured origin for a session, not a hardcoded host', async () => {
    // This endpoint used to be hardcoded to api.nutrient.io, which made a
    // self-hosted deployment impossible however the app was configured.
    vi.stubEnv('NUTRIENT_BASE_URL', 'https://engine.internal:5000');
    const fetchMock = mockFetch(sessionResponse());

    await documentProvider().createViewerSession({ documentId: 'doc_1' });

    expect(sentUrl(fetchMock)).toBe('https://engine.internal:5000/viewer/sessions');
  });

  it('derives the documents path from the same origin', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));

    await documentProvider().deleteDocument({ documentId: 'doc_1' });

    expect(sentUrl(fetchMock)).toBe('https://api.nutrient.io/viewer/documents/doc_1');
  });

  it('serves a self-hosted target from its own implementation, not this one', async () => {
    // This used to assert a refusal. The refusal was deliberate — an untested
    // implementation would have looked like support and failed as subtly wrong
    // requests at a customer site rather than loudly here — and it stood until
    // there was an engine to check against. There now is; see
    // `docker/document-engine/`. What must not come back is the two targets
    // sharing an implementation, which is what this asserts.
    vi.stubEnv('NUTRIENT_TARGET', 'document-engine');
    vi.stubEnv('NUTRIENT_BASE_URL', 'https://engine.internal');
    vi.stubEnv('DOCUMENT_ENGINE_API_TOKEN', 'engine-token');

    expect(documentProvider().target).toBe('document-engine');
  });
});

describe('uploading a document', () => {
  it('returns the stored document and the session issued alongside it', async () => {
    mockFetch(
      uploadResponse({ data: { document_id: 'doc_9', session_token: 'issued.on.upload' } })
    );

    const upload = await documentProvider().uploadDocument({
      file: new File(['pdf bytes'], 'contract.pdf', { type: 'application/pdf' }),
    });

    expect(upload).toEqual({ documentId: 'doc_9', sessionToken: 'issued.on.upload' });
  });

  it('mints a session when the upload did not include one', async () => {
    mockFetch(uploadResponse({ data: { document_id: 'doc_9' } }), sessionResponse());

    const upload = await documentProvider().uploadDocument({
      file: new File(['pdf bytes'], 'contract.pdf', { type: 'application/pdf' }),
    });

    expect(upload).toEqual({ documentId: 'doc_9', sessionToken: 'a.viewer.jwt' });
  });

  it('keeps the uploaded document even when the session is refused', async () => {
    // The document is already stored by this point. Losing its ID because a
    // convenience call failed would orphan it in the backend.
    mockFetch(
      uploadResponse({ data: { document_id: 'doc_9' } }),
      new Response('nope', { status: 403 })
    );

    const upload = await documentProvider().uploadDocument({
      file: new File(['pdf bytes'], 'contract.pdf', { type: 'application/pdf' }),
    });

    expect(upload).toEqual({ documentId: 'doc_9', sessionToken: '' });
  });

  it('reports an upload that returned no document ID', async () => {
    mockFetch(uploadResponse({ data: {} }));

    await expect(
      documentProvider().uploadDocument({
        file: new File(['pdf bytes'], 'contract.pdf', { type: 'application/pdf' }),
      })
    ).rejects.toThrow(/no document ID/);
  });

  it('reports a rejected upload', async () => {
    mockFetch(new Response('too big', { status: 413 }));

    await expect(
      documentProvider().uploadDocument({
        file: new File(['pdf bytes'], 'contract.pdf', { type: 'application/pdf' }),
      })
    ).rejects.toThrow(/413/);
  });
});

describe('deleting a document', () => {
  it('treats a backend that will not delete as done, so our record can still go', async () => {
    mockFetch(new Response('not allowed', { status: 405 }));

    await expect(
      documentProvider().deleteDocument({ documentId: 'doc_1' })
    ).resolves.toBeUndefined();
  });

  it('reports a genuine delete failure', async () => {
    mockFetch(new Response('boom', { status: 500 }));

    await expect(documentProvider().deleteDocument({ documentId: 'doc_1' })).rejects.toThrow(/500/);
  });
});

/**
 * Document Engine is the other backend the seam exists for. The behaviour below
 * was checked against a real engine before it was written down — see
 * `docker/document-engine/README.md`, which brings one up.
 *
 * A fresh keypair per run rather than a fixture: committing a signing key, even
 * a test one, invites it being reached for as a default somewhere real.
 */
const { privateKey: enginePrivateKey, publicKey: enginePublicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

describe('the Document Engine backend', () => {
  beforeEach(() => {
    vi.stubEnv('NUTRIENT_TARGET', 'document-engine');
    vi.stubEnv('NUTRIENT_BASE_URL', 'http://localhost:5001');
    vi.stubEnv('DOCUMENT_ENGINE_API_TOKEN', 'engine-token');
    vi.stubEnv('DOCUMENT_ENGINE_JWT_PRIVATE_KEY', enginePrivateKey);
  });

  it('is served rather than refused, now that one has been run against', () => {
    expect(documentProvider().target).toBe('document-engine');
  });

  it('uploads to /api/documents with token authentication', async () => {
    const fetchMock = mockFetch(uploadResponse({ data: { document_id: 'doc_engine_1' } }));

    const result = await documentProvider().uploadDocument({
      file: new File([new Uint8Array([1, 2, 3])], 'report.pdf', { type: 'application/pdf' }),
    });

    expect(result.documentId).toBe('doc_engine_1');
    expect(sentUrl(fetchMock)).toBe('http://localhost:5001/api/documents');
    // Not `Bearer`. The engine happens to accept both, but only this form is
    // documented, and an undocumented allowance is not a promise.
    expect(sentHeaders(fetchMock).Authorization).toBe('Token token=engine-token');
  });

  it('downloads the stored bytes rather than a re-render', async () => {
    const fetchMock = mockFetch(new Response(new Uint8Array([4, 5, 6])));

    await documentProvider().downloadDocument({ documentId: 'doc_engine_1' });

    // Without `source=true` the engine returns a rendered PDF, which is a
    // different document from the one that was uploaded. A processing job must
    // work on the original.
    expect(sentUrl(fetchMock)).toBe(
      'http://localhost:5001/api/documents/doc_engine_1/pdf?source=true'
    );
  });

  it('builds at /api/build using the same single token', async () => {
    const fetchMock = mockFetch(new Response(new Uint8Array([7, 8, 9])));

    await documentProvider().processDocument({
      source: new Uint8Array([1]),
      filename: 'report.pdf',
      instructions: { parts: [{ file: 'document' }], actions: [{ type: 'applyRedactions' }] },
    });

    expect(sentUrl(fetchMock)).toBe('http://localhost:5001/api/build');
    // Document Engine has no Viewer/Processor split: one token opens everything,
    // so there is no second key to get wrong here.
    expect(sentHeaders(fetchMock).Authorization).toBe('Token token=engine-token');
  });

  it('deletes at /api/documents/{id}', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 200 }));

    await documentProvider().deleteDocument({ documentId: 'doc_engine_1' });

    expect(sentUrl(fetchMock)).toBe('http://localhost:5001/api/documents/doc_engine_1');
    expect(lastCall(fetchMock)?.[1]?.method).toBe('DELETE');
  });

  describe('viewer sessions', () => {
    it('mints one without talking to the engine at all', async () => {
      const fetchMock = mockFetch();

      const session = await documentProvider().createViewerSession({
        documentId: 'doc_engine_1',
        userId: 'user_7',
      });

      // The whole mechanism differs here: DWS asks its API for a session, while
      // Document Engine only ever verifies one. Holding the private key is what
      // makes this a local operation, so a network call would mean the wrong
      // implementation ran.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(session.documentId).toBe('doc_engine_1');
      expect(session.sessionToken).not.toBe('');
    });

    it('signs claims the engine will accept, verifiable with the public key', async () => {
      mockFetch();

      const session = await documentProvider().createViewerSession({
        documentId: 'doc_engine_1',
        userId: 'user_7',
      });

      const claims = verify(session.sessionToken, enginePublicKey, { algorithms: ['RS256'] });

      if (typeof claims === 'string') {
        throw new Error('Expected decoded claims, not a string');
      }

      expect(claims.document_id).toBe('doc_engine_1');
      // The same claim name DWS uses, which is what lets a comment written
      // through either backend be attributed to the same account.
      expect(claims.user_id).toBe('user_7');
      expect(claims.permissions).toContain('read-document');
      // Without `write` the viewer is read-only, so nobody can add a comment —
      // which is the app's whole point.
      expect(claims.permissions).toContain('write');
      expect(typeof claims.exp).toBe('number');
    });

    it('omits user_id when no user is known, rather than sending an empty one', async () => {
      mockFetch();

      const session = await documentProvider().createViewerSession({ documentId: 'doc_engine_1' });
      const claims = verify(session.sessionToken, enginePublicKey, { algorithms: ['RS256'] });

      if (typeof claims === 'string') {
        throw new Error('Expected decoded claims, not a string');
      }

      expect(claims).not.toHaveProperty('user_id');
    });

    it('says which variable is missing when there is no signing key', async () => {
      vi.stubEnv('DOCUMENT_ENGINE_JWT_PRIVATE_KEY', undefined);

      await expect(
        documentProvider().createViewerSession({ documentId: 'doc_engine_1' })
      ).rejects.toThrow(/DOCUMENT_ENGINE_JWT_PRIVATE_KEY/);
    });
  });

  it('says which variable is missing when there is no API token', () => {
    vi.stubEnv('DOCUMENT_ENGINE_API_TOKEN', undefined);

    expect(() => documentProvider()).toThrow(/DOCUMENT_ENGINE_API_TOKEN/);
  });

  it('reads a 403 that names a missing component as configuration, not as a bad token', async () => {
    mockFetch(
      new Response(
        'Requests to /api/documents are disabled. To enable this endpoint please restart ' +
          'Document Engine with these required components: [:persistent_db_storage]',
        { status: 403 }
      )
    );

    // Both conditions answer 403 and only the body tells them apart, so an
    // engine started without PostgreSQL otherwise looks exactly like a wrong
    // token — which is a long way to walk in the wrong direction.
    await expect(
      documentProvider().downloadDocument({ documentId: 'doc_engine_1' })
    ).rejects.toThrow(/persistent_db_storage|database/i);
  });
});
