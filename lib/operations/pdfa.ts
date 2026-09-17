/**
 * What a PDF/A job asks the Processor API to do.
 *
 * **PDF/A is an output type, not an action** — unlike redaction, OCR and
 * watermark, which all add an entry to `actions`. Verified against a live
 * Document Engine (`docs/superpowers/specs/2026-09-16-build-api-shapes.md`):
 * `{"output": {"type": "pdfa", "conformance": "pdfa-2b"}}` is the whole
 * instruction beyond naming the file part — `actions` stays empty.
 */

import { asRecord, type DocumentOperation } from '@/lib/operations/types';

/**
 * Confirmed by probing — see docs/superpowers/specs/2026-09-16-build-api-shapes.md,
 * where all eleven were individually accepted by the live engine. Use the
 * lowercase hyphenated form: uppercase appeared to be accepted too, but only one
 * variant was tried and that is not a rule to rely on.
 */
export const PDFA_CONFORMANCE_LEVELS = [
  'pdfa-1a',
  'pdfa-1b',
  'pdfa-2a',
  'pdfa-2u',
  'pdfa-2b',
  'pdfa-3a',
  'pdfa-3u',
  'pdfa-3b',
  'pdfa-4',
  'pdfa-4e',
  'pdfa-4f',
] as const;

export type PdfaConformance = (typeof PDFA_CONFORMANCE_LEVELS)[number];

/** Presentable names for the API's own identifiers, as OCR and redaction do. */
export const PDFA_CONFORMANCE_LABELS: Record<PdfaConformance, string> = {
  'pdfa-1a': 'PDF/A-1a',
  'pdfa-1b': 'PDF/A-1b',
  'pdfa-2a': 'PDF/A-2a',
  'pdfa-2u': 'PDF/A-2u',
  'pdfa-2b': 'PDF/A-2b',
  'pdfa-3a': 'PDF/A-3a',
  'pdfa-3u': 'PDF/A-3u',
  'pdfa-3b': 'PDF/A-3b',
  'pdfa-4': 'PDF/A-4',
  'pdfa-4e': 'PDF/A-4e',
  'pdfa-4f': 'PDF/A-4f',
};

const isConformance = (value: unknown): value is PdfaConformance =>
  typeof value === 'string' && PDFA_CONFORMANCE_LEVELS.includes(value as PdfaConformance);

/** A Build instruction document, narrowed to what a PDF/A job sends. */
export type PdfaInstructions = {
  parts: readonly [{ file: string }];
  actions: readonly [];
  output: { type: 'pdfa'; conformance: PdfaConformance };
};

/**
 * Turn a validated conformance level into the Build instructions that produce it.
 *
 * `filePartName` must match the multipart field the file is uploaded under, or
 * the API answers `file_not_found` — the reference name and the field name are
 * one fact and so are passed together, the same rule redaction's, OCR's and
 * watermark's builders follow.
 */
export const buildPdfaInstructions = (options: {
  filePartName: string;
  conformance: PdfaConformance;
}): PdfaInstructions => {
  const { filePartName, conformance } = options;

  return {
    parts: [{ file: filePartName }],
    actions: [],
    output: { type: 'pdfa', conformance },
  };
};

export const pdfaOperation: DocumentOperation = {
  kind: 'PDFA',
  label: 'Convert to PDF/A',
  description: 'Produce an archival copy for long-term retention.',
  backends: ['dws', 'document-engine'],
  fields: [
    {
      kind: 'select',
      name: 'conformance',
      label: 'Conformance level',
      options: PDFA_CONFORMANCE_LEVELS.map((level) => ({
        value: level,
        label: PDFA_CONFORMANCE_LABELS[level],
      })),
      defaultValue: 'pdfa-2b',
    },
  ],
  parse: (raw) => {
    const request = asRecord(raw);

    if (!isConformance(request?.conformance)) {
      return {
        ok: false,
        message:
          `"${String(request?.conformance)}" is not a conformance level this deployment offers. ` +
          `Available levels are: ${PDFA_CONFORMANCE_LEVELS.join(', ')}.`,
      };
    }

    const conformance = request.conformance;

    return {
      ok: true,
      outputSuffix: 'pdfa',
      buildInstructions: ({ filePartName }) => buildPdfaInstructions({ filePartName, conformance }),
    };
  },
};
