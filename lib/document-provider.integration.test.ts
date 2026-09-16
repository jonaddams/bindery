// @vitest-environment node

/**
 * The Document Engine provider, against a real Document Engine.
 *
 * **Skipped unless one is running.** `docker/document-engine/up.sh` starts it;
 * this file then finds it at `DOCUMENT_ENGINE_TEST_URL`, defaulting to the port
 * that compose file publishes.
 *
 * It exists because the rest of this suite mocks `fetch`, which proves the
 * provider sends what we believe it should and proves nothing about whether the
 * engine agrees. Every expensive surprise on the DWS side — the session token
 * arriving as `jwt`, the undocumented `/pdf` download, a redaction shape the
 * documentation got wrong — was invisible to a mocked test and obvious to a real
 * one. The seam was built for two backends and had only ever run against one;
 * this is what stops that being true again.
 *
 * It does a full round trip against one document and deletes it afterwards.
 */

import { readFileSync } from 'node:fs';
import { verify } from 'jsonwebtoken';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { documentProvider } from '@/lib/document-provider';

const baseUrl = process.env.DOCUMENT_ENGINE_TEST_URL ?? 'http://localhost:5001';
const token = process.env.DOCUMENT_ENGINE_TEST_TOKEN ?? 'secret';
const keyPath = `${__dirname}/../docker/document-engine/secrets`;

const readKey = (name: string): string | undefined => {
  try {
    return readFileSync(`${keyPath}/${name}`, 'utf8');
  } catch {
    return undefined;
  }
};

const privateKey = readKey('jwt-private.pem');
const publicKey = readKey('jwt-public.pem');

const engineIsRunning = await (async (): Promise<boolean> => {
  if (!privateKey) {
    return false;
  }

  try {
    const response = await fetch(`${baseUrl}/healthcheck`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
})();

/** A PDF containing an address, so redaction can be checked by its absence. */
const samplePdf = async (): Promise<Uint8Array<ArrayBuffer>> => {
  const body = new FormData();
  body.set('instructions', JSON.stringify({ parts: [{ html: 'index.html' }] }));
  body.set(
    'index.html',
    new File(['<html><body><p>Contact: redact-me@example.com</p></body></html>'], 'index.html', {
      type: 'text/html',
    })
  );

  const response = await fetch(`${baseUrl}/api/build`, {
    method: 'POST',
    headers: { Authorization: `Token token=${token}` },
    body,
  });

  return new Uint8Array(await response.arrayBuffer());
};

/** Ask the engine for a document's text, which is how removal is proven. */
const extractText = async (pdf: Uint8Array<ArrayBuffer>): Promise<string> => {
  const body = new FormData();
  body.set(
    'instructions',
    JSON.stringify({
      parts: [{ file: 'document' }],
      output: { type: 'json-content', plainText: true },
    })
  );
  body.set('document', new File([pdf], 'document.pdf', { type: 'application/pdf' }));

  const response = await fetch(`${baseUrl}/api/build`, {
    method: 'POST',
    headers: { Authorization: `Token token=${token}` },
    body,
  });

  return response.text();
};

const uploaded: string[] = [];

afterAll(async () => {
  if (!engineIsRunning) {
    return;
  }

  // Nothing here is precious, but a local engine accumulating documents across
  // runs makes the next failure harder to read.
  for (const documentId of uploaded) {
    await fetch(`${baseUrl}/api/documents/${documentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Token token=${token}` },
    }).catch(() => undefined);
  }
});

describe.skipIf(!engineIsRunning)('against a real Document Engine', () => {
  beforeEach(() => {
    process.env.NUTRIENT_TARGET = 'document-engine';
    process.env.NUTRIENT_BASE_URL = baseUrl;
    process.env.DOCUMENT_ENGINE_API_TOKEN = token;
    process.env.DOCUMENT_ENGINE_JWT_PRIVATE_KEY = privateKey;
  });

  it('stores a document, reads the same bytes back, and deletes it', async () => {
    const provider = documentProvider();
    const pdf = await samplePdf();

    const upload = await provider.uploadDocument({
      file: new File([pdf], 'report.pdf', { type: 'application/pdf' }),
    });
    uploaded.push(upload.documentId);

    expect(upload.documentId).not.toBe('');

    const downloaded = await provider.downloadDocument({ documentId: upload.documentId });

    // Byte-identical, which is what `source=true` buys. Without it the engine
    // returns a re-render, and a processing job would silently operate on a
    // different document from the one that was stored.
    expect(new Uint8Array(downloaded)).toEqual(pdf);

    await expect(
      provider.deleteDocument({ documentId: upload.documentId })
    ).resolves.toBeUndefined();

    await expect(provider.downloadDocument({ documentId: upload.documentId })).rejects.toThrow();
  }, 60_000);

  it('redacts by removing the text, not by drawing over it', async () => {
    const provider = documentProvider();
    const pdf = await samplePdf();

    expect(await extractText(pdf)).toContain('redact-me@example.com');

    const redacted = await provider.processDocument({
      source: pdf,
      filename: 'report.pdf',
      instructions: {
        parts: [{ file: 'document' }],
        actions: [
          {
            type: 'createRedactions',
            strategy: 'preset',
            strategyOptions: { preset: 'email-address' },
          },
          // Without this the output has black boxes over text that is still
          // fully present underneath. It looks redacted and is not, which is
          // why this assertion reads the text rather than the pixels.
          { type: 'applyRedactions' },
        ],
      },
    });

    expect(await extractText(new Uint8Array(redacted))).not.toContain('redact-me@example.com');
  }, 120_000);

  it('signs a session the engine can verify, without calling it', async () => {
    const provider = documentProvider();
    const pdf = await samplePdf();

    const upload = await provider.uploadDocument({
      file: new File([pdf], 'report.pdf', { type: 'application/pdf' }),
    });
    uploaded.push(upload.documentId);

    const session = await provider.createViewerSession({
      documentId: upload.documentId,
      userId: 'user_integration',
    });

    if (!publicKey) {
      throw new Error('Expected a public key beside the private one');
    }

    // Verified with the very key the running engine was handed as
    // JWT_PUBLIC_KEY, so this is the engine's own check, run here.
    const claims = verify(session.sessionToken, publicKey, { algorithms: ['RS256'] });

    if (typeof claims === 'string') {
      throw new Error('Expected decoded claims, not a string');
    }

    expect(claims.document_id).toBe(upload.documentId);
    expect(claims.user_id).toBe('user_integration');
  }, 60_000);

  it('explains a 403 that is really a missing component', async () => {
    // The engine answers 403 both for a bad token and for an endpoint it cannot
    // serve, and only the body separates them. Sending a wrong token proves the
    // plain case still reads as a plain failure.
    process.env.DOCUMENT_ENGINE_API_TOKEN = 'definitely-wrong';

    await expect(documentProvider().downloadDocument({ documentId: 'whatever' })).rejects.toThrow(
      /403/
    );
  }, 30_000);
});
