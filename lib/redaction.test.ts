// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildRedactionInstructions,
  parseRedactionRequest,
  REDACTION_PRESETS,
} from '@/lib/redaction';

describe('Describing a redaction to the Processor API', () => {
  it('redacts a preset pattern across the whole document', () => {
    const instructions = buildRedactionInstructions({
      filePartName: 'document',
      redaction: { strategy: 'preset', preset: 'social-security-number' },
    });

    expect(instructions).toEqual({
      parts: [{ file: 'document' }],
      actions: [
        {
          type: 'createRedactions',
          strategy: 'preset',
          strategyOptions: { preset: 'social-security-number' },
        },
        { type: 'applyRedactions' },
      ],
      output: { type: 'pdf' },
    });
  });

  // Marking and applying are two actions, and both are required. createRedactions
  // alone produces a document with redaction annotations drawn over the text and
  // the text still underneath it — which looks redacted and is not.
  it('applies the redactions it marks, rather than only marking them', () => {
    const instructions = buildRedactionInstructions({
      filePartName: 'document',
      redaction: { strategy: 'preset', preset: 'email-address' },
    });

    expect(instructions.actions.at(-1)).toEqual({ type: 'applyRedactions' });
  });

  it('redacts a regular expression', () => {
    const instructions = buildRedactionInstructions({
      filePartName: 'document',
      redaction: { strategy: 'regex', regex: 'ACME-\\d{4}', caseSensitive: true },
    });

    expect(instructions.actions[0]).toEqual({
      type: 'createRedactions',
      strategy: 'regex',
      strategyOptions: { regex: 'ACME-\\d{4}', caseSensitive: true },
    });
  });

  // The multipart field name has to match what `parts` references, or the API
  // answers file_not_found.
  it('names the file part the caller will upload under', () => {
    const instructions = buildRedactionInstructions({
      filePartName: 'source.pdf',
      redaction: { strategy: 'preset', preset: 'email-address' },
    });

    expect(instructions.parts).toEqual([{ file: 'source.pdf' }]);
  });
});

describe('Reading a redaction request from a caller', () => {
  it('accepts a known preset', () => {
    const result = parseRedactionRequest({ strategy: 'preset', preset: 'credit-card-number' });

    expect(result).toEqual({
      ok: true,
      redaction: { strategy: 'preset', preset: 'credit-card-number' },
    });
  });

  it('refuses a preset the API does not define, naming what is available', () => {
    const result = parseRedactionRequest({ strategy: 'preset', preset: 'passport-number' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('passport-number');
    expect(result.ok === false && result.message).toContain('social-security-number');
  });

  it('accepts a regular expression', () => {
    const result = parseRedactionRequest({ strategy: 'regex', regex: '\\d{3}-\\d{2}-\\d{4}' });

    expect(result).toEqual({
      ok: true,
      redaction: { strategy: 'regex', regex: '\\d{3}-\\d{2}-\\d{4}', caseSensitive: false },
    });
  });

  it('carries case sensitivity through when asked for', () => {
    const result = parseRedactionRequest({
      strategy: 'regex',
      regex: 'Confidential',
      caseSensitive: true,
    });

    expect(result.ok === true && result.redaction).toEqual({
      strategy: 'regex',
      regex: 'Confidential',
      caseSensitive: true,
    });
  });

  // A pattern the API cannot compile fails the whole job after it has been
  // queued, accepted and paid for. Rejecting it at the door costs nothing.
  it('refuses a regular expression that does not compile', () => {
    const result = parseRedactionRequest({ strategy: 'regex', regex: '([unclosed' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/regular expression/i);
  });

  it('refuses an empty regular expression, which would match everywhere', () => {
    const result = parseRedactionRequest({ strategy: 'regex', regex: '' });

    expect(result.ok).toBe(false);
  });

  it('refuses an unknown strategy', () => {
    const result = parseRedactionRequest({ strategy: 'vibes' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/preset|regex/);
  });

  // AI redaction is a deliberate omission, not an oversight: a live model pass
  // that misses an SSN is a compliance claim this app should not make.
  it('refuses AI redaction, which this app deliberately does not offer', () => {
    const result = parseRedactionRequest({ strategy: 'ai', criteria: 'all PII' });

    expect(result.ok).toBe(false);
  });

  it('refuses a request that is not an object at all', () => {
    expect(parseRedactionRequest(null).ok).toBe(false);
    expect(parseRedactionRequest('preset').ok).toBe(false);
  });

  it('refuses a preset request with no preset named', () => {
    expect(parseRedactionRequest({ strategy: 'preset' }).ok).toBe(false);
  });
});

describe('The offered presets', () => {
  it('are the ones the Processor API documents', () => {
    expect(REDACTION_PRESETS).toContain('social-security-number');
    expect(REDACTION_PRESETS).toContain('email-address');
    expect(REDACTION_PRESETS).toContain('north-american-phone-number');
  });
});
