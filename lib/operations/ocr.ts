/**
 * What an OCR job asks the Processor API to do.
 *
 * **OCR is a single action**, unlike redaction's two — verified against a live
 * Document Engine (`docs/superpowers/specs/2026-09-16-build-api-shapes.md`):
 * `{"type": "ocr", "language": "english"}` is fully valid on its own, no second
 * action required.
 *
 * **The language list is deliberately narrower than what the probed engine
 * accepted.** The probe found that every non-Latin-script language
 * (`jpn`, `ara`, `rus`, `chi_sim`, …) also works, but only as a 3-letter
 * Tesseract code, never as a full English word — and that alias table looks
 * like a property of the engine image's bundled Tesseract packs, not a
 * documented API contract. It was never checked against the hosted DWS API.
 * Offering those codes here would risk a menu entry that fails mid-job on a
 * backend that does not carry the same packs, so only the Latin-script
 * full-word languages — confirmed accepted — are listed.
 */

import type { DocumentOperation } from '@/lib/operations/types';

export const OCR_LANGUAGES = [
  'english',
  'german',
  'french',
  'spanish',
  'italian',
  'portuguese',
  'dutch',
  'swedish',
  'polish',
  'czech',
  'turkish',
] as const;

export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

/**
 * What to call each language in front of a person, mirroring
 * `REDACTION_PRESET_LABELS`. A map rather than a transform, because the API's
 * identifiers are its own and need not be presentable.
 */
export const OCR_LANGUAGE_LABELS: Record<OcrLanguage, string> = {
  english: 'English',
  german: 'German',
  french: 'French',
  spanish: 'Spanish',
  italian: 'Italian',
  portuguese: 'Portuguese',
  dutch: 'Dutch',
  swedish: 'Swedish',
  polish: 'Polish',
  czech: 'Czech',
  turkish: 'Turkish',
};

const isLanguage = (value: unknown): value is OcrLanguage =>
  typeof value === 'string' && OCR_LANGUAGES.includes(value as OcrLanguage);

/** Mirrors redaction's `asRecord`: narrows without asserting a caller-supplied shape. */
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** A Build instruction document, narrowed to what an OCR job sends. */
export type OcrInstructions = {
  parts: readonly [{ file: string }];
  actions: readonly [{ type: 'ocr'; language: OcrLanguage }];
  output: { type: 'pdf' };
};

/**
 * Turn a validated language into the Build instructions that perform OCR.
 *
 * `filePartName` must match the multipart field the file is uploaded under, or
 * the API answers `file_not_found` — the reference name and the field name are
 * one fact and so are passed together, the same rule redaction's builder
 * follows.
 */
export const buildOcrInstructions = (options: {
  filePartName: string;
  language: OcrLanguage;
}): OcrInstructions => {
  const { filePartName, language } = options;

  return {
    parts: [{ file: filePartName }],
    actions: [{ type: 'ocr', language }],
    output: { type: 'pdf' },
  };
};

export const ocrOperation: DocumentOperation = {
  kind: 'OCR',
  label: 'OCR',
  description: 'Recognise text in a scan so it can be searched and selected.',
  backends: ['dws', 'document-engine'],
  fields: [
    {
      kind: 'select',
      name: 'language',
      label: 'Language',
      options: OCR_LANGUAGES.map((language) => ({
        value: language,
        label: OCR_LANGUAGE_LABELS[language],
      })),
      defaultValue: 'english',
    },
  ],
  parse: (raw) => {
    const request = asRecord(raw);

    if (!isLanguage(request?.language)) {
      return {
        ok: false,
        message:
          `"${String(request?.language)}" is not a language this deployment offers. ` +
          `Available languages are: ${OCR_LANGUAGES.join(', ')}.`,
      };
    }

    const language = request.language;

    return {
      ok: true,
      outputSuffix: 'ocr',
      buildInstructions: ({ filePartName }) => buildOcrInstructions({ filePartName, language }),
    };
  },
};
