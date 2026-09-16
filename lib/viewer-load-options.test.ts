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

  it('loads assets from the CDN explicitly, as the DWS path does', () => {
    // The app serves the SDK from the CDN, so assets resolve there either way —
    // but only by auto-detection, which the SDK warns it will stop doing. Being
    // explicit silences the warning and keeps the two backends behaving alike.
    expect(engineOptions().useCDN).toBe(true);
  });

  it('points at the engine and turns on Instant, which is how it syncs', () => {
    const options = engineOptions();

    expect(options.serverUrl).toBe('http://localhost:5001/');
    expect(options.instant).toBe(true);
  });

  it('gives the SDK the trailing slash it insists on', () => {
    // Found in a browser, not in a test: the SDK rejects a `serverUrl` without
    // a trailing slash outright — "`serverUrl` must have a slash at the end".
    // `NUTRIENT_BASE_URL` is deliberately stored as an origin *without* one,
    // because every server-side call site appends its own path, so the slash
    // has to be added here rather than by relaxing the config's rule.
    const options = viewerLoadOptions({
      container,
      target: 'document-engine',
      serverUrl: 'http://localhost:5001',
      ...backend,
    });

    expect(options.serverUrl).toBe('http://localhost:5001/');
  });

  it('does not double the slash when one is already there', () => {
    const options = viewerLoadOptions({
      container,
      target: 'document-engine',
      serverUrl: 'http://localhost:5001/',
      ...backend,
    });

    expect(options.serverUrl).toBe('http://localhost:5001/');
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
