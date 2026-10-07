// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { compressOperation } from '@/lib/operations/compress';
import { flattenOperation } from '@/lib/operations/flatten';
import { pdfuaOperation } from '@/lib/operations/pdfua';
import { rotateOperation } from '@/lib/operations/rotate';
import type { DocumentOperation } from '@/lib/operations/types';

/** Shapes verified in docs/superpowers/specs/2026-10-07-build-api-shapes-more.md. */
const instructionsFor = (operation: DocumentOperation, request: Record<string, unknown>) => {
  const result = operation.parse({ kind: operation.kind, ...request });
  if (!result.ok) throw new Error(result.message);
  return { result, instructions: result.buildInstructions({ filePartName: 'document' }) };
};

describe('PDF/UA', () => {
  it('asks for a PDF/UA output, which is an output type rather than an action', () => {
    const { instructions } = instructionsFor(pdfuaOperation, {});

    expect(instructions).toEqual({
      parts: [{ file: 'document' }],
      actions: [],
      output: { type: 'pdfua' },
    });
  });

  it('marks its output', () => {
    expect(instructionsFor(pdfuaOperation, {}).result.outputSuffix).toBe('pdfua');
  });
});

describe('Compress', () => {
  it('recompresses images at the quality the chosen level stands for', () => {
    const { instructions } = instructionsFor(compressOperation, { level: 'light' });

    expect(instructions.output).toEqual({ type: 'pdf', optimize: { imageOptimizationQuality: 4 } });
  });

  // MRC is what the API calls hypercompression: on a 718 KB image PDF it took
  // quality 1 from 35 KB to 22 KB.
  it('adds MRC hypercompression at the maximum level', () => {
    const { instructions } = instructionsFor(compressOperation, { level: 'maximum' });

    expect(instructions.output).toEqual({
      type: 'pdf',
      optimize: { imageOptimizationQuality: 1, mrcCompression: true },
    });
  });

  it('names the level in job history', () => {
    expect(instructionsFor(compressOperation, { level: 'maximum' }).result.summary).toBe('Maximum');
  });

  it('refuses a level it does not offer, naming the ones it does', () => {
    const result = compressOperation.parse({ kind: 'COMPRESS', level: 'extreme' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('maximum');
  });

  // The probe found linearize is accepted and ignored on both backends, while any
  // optimize block recompresses images. A "fast web view" option would degrade
  // images and not linearize.
  it('never asks for linearization, which neither backend performs', () => {
    for (const level of ['light', 'strong', 'maximum']) {
      const { instructions } = instructionsFor(compressOperation, { level });
      expect(JSON.stringify(instructions)).not.toContain('linearize');
    }
  });
});

describe('Flatten', () => {
  it('flattens annotations and form fields into the page', () => {
    const { instructions } = instructionsFor(flattenOperation, {});

    expect(instructions.actions).toEqual([{ type: 'flatten' }]);
  });
});

describe('Rotate', () => {
  it('turns every page by the chosen amount', () => {
    const { instructions } = instructionsFor(rotateOperation, { degrees: '90' });

    expect(instructions.actions).toEqual([{ type: 'rotate', rotateBy: 90 }]);
  });

  it('says which way in job history', () => {
    expect(instructionsFor(rotateOperation, { degrees: '270' }).result.summary).toBe(
      '90° counter-clockwise'
    );
  });

  // The API accepts only quarter turns, so anything else is refused here with a
  // readable message rather than as a failed job later.
  it('refuses anything but a quarter turn', () => {
    const result = rotateOperation.parse({ kind: 'ROTATE', degrees: '45' });

    expect(result.ok).toBe(false);
  });
});
