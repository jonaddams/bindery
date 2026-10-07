/**
 * What a convert job asks the Processor API to do: nothing but produce a PDF.
 *
 * Both backends convert an Office file or an image when the part is that file
 * and the output is `{"type": "pdf"}` — verified with a .docx (its text survives)
 * and a PNG (it becomes a page) in
 * `docs/superpowers/specs/2026-10-07-build-api-shapes-more.md`.
 */

import type { DocumentOperation } from '@/lib/operations/types';

export const convertOperation: DocumentOperation = {
  kind: 'CONVERT',
  label: 'Convert to PDF',
  description: 'Make a PDF copy of this file.',
  backends: ['dws', 'document-engine'],
  fields: [],
  appliesTo: (fileType) => fileType !== 'application/pdf',
  parse: () => ({
    ok: true,
    outputSuffix: 'converted',
    summary: '',
    parameters: {},
    buildInstructions: ({ filePartName }) => ({
      parts: [{ file: filePartName }],
      actions: [],
      output: { type: 'pdf' },
    }),
  }),
};
