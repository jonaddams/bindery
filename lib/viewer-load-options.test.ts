// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { viewerLoadOptions } from '@/lib/viewer-load-options';

const container = {} as HTMLElement;

const backend = {
  documentId: 'doc_1',
  sessionToken: 'a.signed.jwt',
  mentionableUsers: [],
};

describe('Opening a document against DWS', () => {
  it('passes the session token, which is the whole of what DWS needs', () => {
    const options = viewerLoadOptions({ container, target: 'dws', serverUrl: null, ...backend });

    expect(options.session).toBe('a.signed.jwt');
    // A DWS session token names its own document, so there is nothing else to say.
    expect(options.documentId).toBeUndefined();
    expect(options.serverUrl).toBeUndefined();
    expect(options.authPayload).toBeUndefined();
  });

  it('loads assets from the CDN', () => {
    const options = viewerLoadOptions({ container, target: 'dws', serverUrl: null, ...backend });

    expect(options.useCDN).toBe(true);
  });
});

describe('Opening a document against Document Engine', () => {
  const engineOptions = () =>
    viewerLoadOptions({
      container,
      target: 'document-engine',
      serverUrl: 'http://localhost:5001',
      ...backend,
    });

  it('names the document separately, because the JWT is not a DWS session', () => {
    const options = engineOptions();

    // Document Engine authenticates with `authPayload.jwt` and is told the
    // document by `documentId`. Passing the token as `session` — the DWS shape —
    // is silently wrong: the viewer simply never loads.
    expect(options.documentId).toBe('doc_1');
    expect(options.authPayload).toEqual({ jwt: 'a.signed.jwt' });
    expect(options.session).toBeUndefined();
  });

  it('points at the engine and turns on Instant, which is how it syncs', () => {
    const options = engineOptions();

    expect(options.serverUrl).toBe('http://localhost:5001');
    expect(options.instant).toBe(true);
  });

  it('refuses to load without a server URL rather than guessing one', () => {
    // Left to itself the SDK infers `serverUrl` from where its own script was
    // served, which on this app is the Nutrient CDN — so a missing URL would
    // send the browser looking for the customer's documents on Nutrient's
    // servers. Failing here names the misconfiguration instead.
    expect(() =>
      viewerLoadOptions({ container, target: 'document-engine', serverUrl: null, ...backend })
    ).toThrow(/serverUrl/);
  });
});

describe('What both backends share', () => {
  it('carries the mention directory either way', () => {
    const mentionableUsers = [{ id: 'user_1', name: 'Jon', displayName: 'Jon', avatar: null }];

    for (const target of ['dws', 'document-engine'] as const) {
      const options = viewerLoadOptions({
        container,
        target,
        serverUrl: 'http://localhost:5001',
        ...backend,
        mentionableUsers,
      });

      expect(options.mentionableUsers).toEqual(mentionableUsers);
    }
  });
});
