/**
 * What a rotate job asks the Processor API to do: one `rotate` action on every
 * page. Both backends reject anything but `rotateBy` 90, 180 or 270, and the
 * output's page rotation was confirmed with `pdfinfo`
 * (`docs/superpowers/specs/2026-10-07-build-api-shapes-more.md`).
 */

import { asRecord, type DocumentOperation } from '@/lib/operations/types';

const TURNS = {
  90: '90° clockwise',
  180: '180°',
  270: '90° counter-clockwise',
} as const;

type Turn = keyof typeof TURNS;

/** A select submits "90"; stored parameters hold 90. Both mean the same turn. */
const asTurn = (value: unknown): Turn | undefined => {
  const degrees = Number(value);
  return degrees === 90 || degrees === 180 || degrees === 270 ? degrees : undefined;
};

export const rotateOperation: DocumentOperation = {
  kind: 'ROTATE',
  label: 'Rotate',
  description: 'Turn every page.',
  backends: ['dws', 'document-engine'],
  fields: [
    {
      kind: 'select',
      name: 'degrees',
      label: 'Direction',
      options: Object.entries(TURNS).map(([value, label]) => ({ value, label })),
      defaultValue: '90',
    },
  ],
  parse: (raw) => {
    const requested = asRecord(raw)?.degrees;
    const degrees = asTurn(requested);

    if (degrees === undefined) {
      return {
        ok: false,
        message: `Pages can only be turned by 90, 180 or 270 degrees, not "${String(requested)}".`,
      };
    }

    return {
      ok: true,
      outputSuffix: 'rotated',
      summary: TURNS[degrees],
      parameters: { degrees },
      buildInstructions: ({ filePartName }) => ({
        parts: [{ file: filePartName }],
        actions: [{ type: 'rotate', rotateBy: degrees }],
        output: { type: 'pdf' },
      }),
    };
  },
};
