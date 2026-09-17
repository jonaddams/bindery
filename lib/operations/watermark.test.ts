// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { WATERMARK_MAX_LENGTH, watermarkOperation } from '@/lib/operations/watermark';

describe('Watermark', () => {
  it('stamps the text it was given', () => {
    const result = watermarkOperation.parse({ kind: 'WATERMARK', text: 'CONFIDENTIAL' });

    if (!result.ok) throw new Error(result.message);

    const instructions = result.buildInstructions({ filePartName: 'document' });

    expect(instructions.actions).toContainEqual(
      expect.objectContaining({ type: 'watermark', text: 'CONFIDENTIAL' })
    );
  });

  it('sends the width and height the API requires for a text watermark', () => {
    // Verified in Task 1: `text` alone is rejected with `width` and `height`
    // both "can't be blank". Both are mandatory for a text watermark — an image
    // watermark needs only one, which is a different code path we do not offer.
    const result = watermarkOperation.parse({ kind: 'WATERMARK', text: 'CONFIDENTIAL' });

    if (!result.ok) throw new Error(result.message);

    expect(result.buildInstructions({ filePartName: 'document' }).actions).toContainEqual(
      expect.objectContaining({ width: '50%', height: '50%' })
    );
  });

  it('refuses empty text rather than stamping nothing', () => {
    const result = watermarkOperation.parse({ kind: 'WATERMARK', text: '   ' });

    expect(result.ok).toBe(false);
  });

  it('refuses text too long to render sensibly, naming the limit', () => {
    const result = watermarkOperation.parse({
      kind: 'WATERMARK',
      text: 'x'.repeat(WATERMARK_MAX_LENGTH + 1),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(String(WATERMARK_MAX_LENGTH));
  });
});
