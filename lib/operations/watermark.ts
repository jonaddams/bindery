/**
 * What a watermark job asks the Processor API to do.
 *
 * **Watermark is a single action**, like OCR — verified against a live
 * Document Engine (`docs/superpowers/specs/2026-09-16-build-api-shapes.md`):
 * `{"type": "watermark", "text": ..., "width": "50%", "height": "50%"}` is
 * fully valid on its own, no second action required.
 *
 * **A text watermark requires both `width` and `height`, and that is easy to
 * get wrong.** The probe found that `text` alone is rejected with `width` and
 * `height` both `` can't be blank `` — an *image* watermark needs only one of
 * the two, with the other derived from the image's aspect ratio, but that is a
 * different code path this app does not offer. Both dimensions are fixed here
 * rather than exposed as fields: a watermark that covers half the page is what
 * the operation means, and two more fields would be two more things to
 * validate for no gain a reader asked for.
 */

import { asRecord, type DocumentOperation } from '@/lib/operations/types';

/**
 * Long enough for "CONFIDENTIAL — DO NOT DISTRIBUTE", short enough that it still
 * renders as a watermark rather than a paragraph across the page.
 */
export const WATERMARK_MAX_LENGTH = 64;

/**
 * The API requires both dimensions for a *text* watermark and rejects the action
 * without them — verified in Task 1, where `text` alone came back with `width`
 * and `height` each "can't be blank". They are fixed rather than exposed: a
 * watermark that covers half the page is what the operation means, and two more
 * fields would be two more things to validate for no gain a reader asked for.
 */
const WATERMARK_SIZE = { width: '50%', height: '50%' } as const;

/** A Build instruction document, narrowed to what a watermark job sends. */
export type WatermarkInstructions = {
  parts: readonly [{ file: string }];
  actions: readonly [{ type: 'watermark'; text: string; width: string; height: string }];
  output: { type: 'pdf' };
};

/**
 * Turn a validated watermark text into the Build instructions that stamp it.
 *
 * `filePartName` must match the multipart field the file is uploaded under, or
 * the API answers `file_not_found` — the reference name and the field name are
 * one fact and so are passed together, the same rule redaction's and OCR's
 * builders follow.
 */
export const buildWatermarkInstructions = (options: {
  filePartName: string;
  text: string;
}): WatermarkInstructions => {
  const { filePartName, text } = options;

  return {
    parts: [{ file: filePartName }],
    actions: [{ type: 'watermark', text, ...WATERMARK_SIZE }],
    output: { type: 'pdf' },
  };
};

export const watermarkOperation: DocumentOperation = {
  kind: 'WATERMARK',
  label: 'Watermark',
  description: 'Stamp text across every page.',
  backends: ['dws', 'document-engine'],
  fields: [
    {
      kind: 'text',
      name: 'text',
      label: 'Watermark text',
      placeholder: 'CONFIDENTIAL',
      maxLength: WATERMARK_MAX_LENGTH,
    },
  ],
  parse: (raw) => {
    const request = asRecord(raw);
    const text = typeof request?.text === 'string' ? request.text.trim() : '';

    if (text.length === 0) {
      return { ok: false, message: 'Watermark text is required.' };
    }

    if (text.length > WATERMARK_MAX_LENGTH) {
      return {
        ok: false,
        message: `Watermark text must be ${WATERMARK_MAX_LENGTH} characters or fewer.`,
      };
    }

    return {
      ok: true,
      outputSuffix: 'watermarked',
      buildInstructions: ({ filePartName }) => buildWatermarkInstructions({ filePartName, text }),
    };
  },
};
