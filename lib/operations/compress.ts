/**
 * What a compress job asks the Processor API to do.
 *
 * Compression is an `output.optimize` block, not an action. Verified on both
 * backends (`docs/superpowers/specs/2026-10-07-build-api-shapes-more.md`): a
 * 718 KB image-heavy PDF came back at 187 KB at quality 4, 35 KB at quality 1,
 * and 22 KB at quality 1 with MRC — the API's "hypercompression".
 *
 * **It is lossy, always.** Any `optimize` block recompresses images, even one
 * that names no quality. That is also why there is no "fast web view" option:
 * `optimize.linearize` is accepted and ignored by both backends, so it would
 * cost image quality and deliver nothing.
 */

import { asRecord, type DocumentOperation } from '@/lib/operations/types';

const LEVELS = {
  light: { label: 'Light', optimize: { imageOptimizationQuality: 4 } },
  strong: { label: 'Strong', optimize: { imageOptimizationQuality: 2 } },
  maximum: { label: 'Maximum', optimize: { imageOptimizationQuality: 1, mrcCompression: true } },
} as const;

type CompressLevel = keyof typeof LEVELS;

const isLevel = (value: unknown): value is CompressLevel =>
  typeof value === 'string' && Object.hasOwn(LEVELS, value);

export const compressOperation: DocumentOperation = {
  kind: 'COMPRESS',
  label: 'Compress',
  description: 'Shrink the file by recompressing its images. Some image quality is lost.',
  backends: ['dws', 'document-engine'],
  fields: [
    {
      kind: 'select',
      name: 'level',
      label: 'Level',
      options: [
        { value: 'light', label: 'Light — keeps most image quality' },
        { value: 'strong', label: 'Strong' },
        { value: 'maximum', label: 'Maximum — MRC hypercompression' },
      ],
      defaultValue: 'strong',
    },
  ],
  parse: (raw) => {
    const level = asRecord(raw)?.level;

    if (!isLevel(level)) {
      return {
        ok: false,
        message: `"${String(level)}" is not a compression level. Use one of: ${Object.keys(LEVELS).join(', ')}.`,
      };
    }

    const { label, optimize } = LEVELS[level];

    return {
      ok: true,
      outputSuffix: 'compressed',
      summary: label,
      parameters: { level },
      buildInstructions: ({ filePartName }) => ({
        parts: [{ file: filePartName }],
        actions: [],
        output: { type: 'pdf', optimize },
      }),
    };
  },
};
