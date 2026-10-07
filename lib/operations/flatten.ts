/**
 * What a flatten job asks the Processor API to do: one `flatten` action.
 *
 * Verified on both backends (`docs/superpowers/specs/2026-10-07-build-api-shapes-more.md`):
 * annotations and form widgets are removed as objects while what they showed
 * stays on the page, so the copy looks the same and can no longer be edited.
 */

import type { DocumentOperation } from '@/lib/operations/types';

export const flattenOperation: DocumentOperation = {
  kind: 'FLATTEN',
  label: 'Flatten',
  description: 'Burn annotations and form fields into the page.',
  backends: ['dws', 'document-engine'],
  fields: [],
  parse: () => ({
    ok: true,
    outputSuffix: 'flattened',
    summary: '',
    parameters: {},
    buildInstructions: ({ filePartName }) => ({
      parts: [{ file: filePartName }],
      actions: [{ type: 'flatten' }],
      output: { type: 'pdf' },
    }),
  }),
};
