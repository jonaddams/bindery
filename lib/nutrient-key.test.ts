// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { resolveProcessorApiKey, resolveViewerApiKey } from '@/lib/nutrient-key';

describe('Choosing the Nutrient API key', () => {
  it('uses the viewer key', () => {
    expect(resolveViewerApiKey({ NUTRIENT_VIEWER_API_KEY: 'viewer-key' })).toBe('viewer-key');
  });

  it('accepts the old single-key name, so an existing deployment keeps working', () => {
    expect(resolveViewerApiKey({ NUTRIENT_API_KEY: 'legacy-key' })).toBe('legacy-key');
  });

  it('prefers the viewer key when a deployment still carries both', () => {
    expect(
      resolveViewerApiKey({
        NUTRIENT_VIEWER_API_KEY: 'viewer-key',
        NUTRIENT_API_KEY: 'legacy-key',
      })
    ).toBe('viewer-key');
  });

  it('treats an empty value as absent rather than sending an empty bearer token', () => {
    expect(
      resolveViewerApiKey({ NUTRIENT_VIEWER_API_KEY: '', NUTRIENT_API_KEY: 'legacy-key' })
    ).toBe('legacy-key');
  });

  it('names the variable to set when nothing is configured', () => {
    expect(() => resolveViewerApiKey({})).toThrow(/NUTRIENT_VIEWER_API_KEY/);
  });

  it('says which product surface the key is for, since the processor key is a different one', () => {
    expect(() => resolveViewerApiKey({})).toThrow(/[Vv]iewer/);
  });
});

describe('Choosing the Nutrient Processor API key', () => {
  it('uses the processor key', () => {
    expect(resolveProcessorApiKey({ NUTRIENT_PROCESSOR_API_KEY: 'processor-key' })).toBe(
      'processor-key'
    );
  });

  it('treats an empty value as absent rather than sending an empty bearer token', () => {
    expect(() => resolveProcessorApiKey({ NUTRIENT_PROCESSOR_API_KEY: '' })).toThrow(
      /NUTRIENT_PROCESSOR_API_KEY/
    );
  });

  it('names the variable to set when nothing is configured', () => {
    expect(() => resolveProcessorApiKey({})).toThrow(/NUTRIENT_PROCESSOR_API_KEY/);
  });

  // The two keys are not interchangeable in either direction: the viewer key
  // answers 403 to POST /build, confirmed against the live API. Falling back to
  // it would turn a missing-configuration error into an opaque Forbidden.
  it('does not fall back to the viewer key, which the Processor API answers 403 to', () => {
    expect(() => resolveProcessorApiKey({ NUTRIENT_VIEWER_API_KEY: 'viewer-key' })).toThrow(
      /NUTRIENT_PROCESSOR_API_KEY/
    );
  });

  it('does not fall back to the old single-key name, which held a viewer key', () => {
    expect(() => resolveProcessorApiKey({ NUTRIENT_API_KEY: 'legacy-key' })).toThrow(
      /NUTRIENT_PROCESSOR_API_KEY/
    );
  });

  it('says which product surface the key is for', () => {
    expect(() => resolveProcessorApiKey({})).toThrow(/[Pp]rocessor/);
  });
});
