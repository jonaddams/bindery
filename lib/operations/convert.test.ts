// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { operationsForDocument, toolsUnavailableReason } from '@/lib/operations';
import { convertOperation } from '@/lib/operations/convert';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('Converting to PDF', () => {
  // Both backends convert Office files and images given a plain PDF output
  // (docs/superpowers/specs/2026-10-07-build-api-shapes-more.md).
  it('asks for a PDF of the file, with no other work', () => {
    const result = convertOperation.parse({ kind: 'CONVERT' });
    if (!result.ok) throw new Error(result.message);

    expect(result.buildInstructions({ filePartName: 'document' })).toEqual({
      parts: [{ file: 'document' }],
      actions: [],
      output: { type: 'pdf' },
    });
  });

  it('marks its output', () => {
    const result = convertOperation.parse({ kind: 'CONVERT' });
    if (!result.ok) throw new Error(result.message);

    expect(result.outputSuffix).toBe('converted');
  });
});

describe('A password-protected copy', () => {
  // DWS will not hand the copy back without its password, so every job on it
  // would fail at the download step.
  it('cannot have tools run on it, and says why', () => {
    expect(toolsUnavailableReason({ producedByJob: { kind: 'PROTECT' } })).toMatch(
      /password-protected/i
    );
  });

  it('does not stop tools on anything else', () => {
    expect(toolsUnavailableReason({ producedByJob: { kind: 'COMPRESS' } })).toBeNull();
    expect(toolsUnavailableReason({ producedByJob: null })).toBeNull();
  });
});

describe('Which tools a document is offered', () => {
  const kindsFor = (fileType: string) =>
    operationsForDocument({ target: 'dws', fileType }).map((operation) => operation.kind);

  it('offers conversion for an Office document or an image', () => {
    expect(kindsFor(DOCX)).toContain('CONVERT');
    expect(kindsFor('image/png')).toContain('CONVERT');
  });

  it('does not offer converting a PDF to a PDF', () => {
    expect(kindsFor('application/pdf')).not.toContain('CONVERT');
  });

  it('still offers every other tool, whatever the file', () => {
    expect(kindsFor('application/pdf')).toContain('REDACTION');
    expect(kindsFor(DOCX)).toContain('REDACTION');
  });
});
