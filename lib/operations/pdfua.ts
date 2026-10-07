/**
 * What a PDF/UA job asks the Processor API to do.
 *
 * Like PDF/A, **PDF/UA is an output type, not an action**:
 * `{"output": {"type": "pdfua"}}` with `actions` empty. Verified on both
 * backends (`docs/superpowers/specs/2026-10-07-build-api-shapes-more.md`): the
 * output is tagged, carries the PDF/UA identifier, and keeps form values.
 */

import type { DocumentOperation } from '@/lib/operations/types';

export const pdfuaOperation: DocumentOperation = {
  kind: 'PDFUA',
  label: 'PDF/UA',
  description: 'Tag the document so assistive technology can read it.',
  backends: ['dws', 'document-engine'],
  fields: [],
  parse: () => ({
    ok: true,
    outputSuffix: 'pdfua',
    summary: '',
    parameters: {},
    buildInstructions: ({ filePartName }) => ({
      parts: [{ file: filePartName }],
      actions: [],
      output: { type: 'pdfua' },
    }),
  }),
};
