// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { PDFA_CONFORMANCE_LEVELS, pdfaOperation } from '@/lib/operations/pdfa';

describe('PDF/A conversion', () => {
  it('asks for the requested conformance level', () => {
    const level = PDFA_CONFORMANCE_LEVELS[0];
    const result = pdfaOperation.parse({ kind: 'PDFA', conformance: level });

    if (!result.ok) throw new Error(result.message);

    const instructions = result.buildInstructions({ filePartName: 'document' });

    // PDF/A is an output type rather than an action — see the shapes document.
    expect(instructions.output).toEqual(expect.objectContaining({ conformance: level }));
  });

  it('names the levels it offers when given one it does not', () => {
    const result = pdfaOperation.parse({ kind: 'PDFA', conformance: 'pdfa-99z' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(PDFA_CONFORMANCE_LEVELS[0]);
  });
});
