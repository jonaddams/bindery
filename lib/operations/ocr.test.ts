// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { ocrOperation } from '@/lib/operations/ocr';

describe('OCR', () => {
  it('builds instructions for the requested language', () => {
    const result = ocrOperation.parse({ kind: 'OCR', language: 'english' });

    if (!result.ok) {
      throw new Error(`Expected a valid request, got: ${result.message}`);
    }

    const instructions = result.buildInstructions({ filePartName: 'document' });

    expect(instructions.parts).toEqual([{ file: 'document' }]);
    expect(instructions.actions).toContainEqual(
      expect.objectContaining({ type: 'ocr', language: 'english' })
    );
  });

  it('names the languages it offers when given one it does not', () => {
    const result = ocrOperation.parse({ kind: 'OCR', language: 'klingon' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('english');
  });

  it('marks its output so it cannot be mistaken for the original', () => {
    const result = ocrOperation.parse({ kind: 'OCR', language: 'english' });

    if (!result.ok) throw new Error('Expected a valid request');
    expect(result.outputSuffix).toBe('ocr');
  });
});
