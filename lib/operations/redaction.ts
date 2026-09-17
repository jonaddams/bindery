/**
 * What a redaction job asks the Processor API to do.
 *
 * Redaction is the first Processor operation this app performs, so this module
 * carries the shape of a Build instruction as well as the rules for one
 * particular action. Both belong together until there is a second operation to
 * generalise against — an abstraction invented ahead of its second caller tends
 * to be the wrong one.
 *
 * **Redaction is two actions: `createRedactions` then `applyRedactions`**, with
 * the pattern nested under `strategyOptions` rather than sitting flat on the
 * action. This is verified against the live API, and it contradicts the
 * documentation that was to hand, which described a single `redaction` action
 * carrying a flat `preset`. That shape is rejected outright:
 * "`redaction` is not a supported action type". Do not trust a redaction example
 * without running it.
 *
 * Both actions are required, and the failure mode if the second is forgotten is
 * the dangerous one: `createRedactions` only *marks* text, producing a document
 * with black boxes drawn over content that is still fully present underneath.
 * It looks redacted. Copying the text out returns it.
 *
 * **AI redaction is deliberately not offered.** The API supports an
 * `ai_redaction` action taking natural-language criteria, and it is the wrong
 * thing to demonstrate: a live model pass that misses a social security number
 * is a compliance claim, made silently, in a reference implementation someone
 * will copy. Preset and regex redaction are deterministic and a reader can
 * verify what they did. `parseRedactionRequest` refuses `ai` explicitly rather
 * than by omission, so the refusal is legible.
 */

import type { DocumentOperation } from '@/lib/operations/types';

/**
 * The patterns the Processor API knows by name.
 *
 * Kept as a list rather than left to the API because an unknown preset is
 * otherwise only discovered after the job has been queued, accepted and billed.
 */
export const REDACTION_PRESETS = [
  'social-security-number',
  'credit-card-number',
  'email-address',
  'north-american-phone-number',
  'international-phone-number',
  'date',
  'url',
  'ipv4',
  'ipv6',
  'mac-address',
  'us-zip-code',
  'vin',
  'time',
] as const;

export type RedactionPreset = (typeof REDACTION_PRESETS)[number];

/**
 * What to call each preset in front of a person.
 *
 * The API's own identifiers are kebab-case slugs, and putting
 * `north-american-phone-number` in a dropdown is an implementation detail
 * leaking into someone's face. Plural, because a redaction removes every match
 * rather than one.
 */
export const REDACTION_PRESET_LABELS: Record<RedactionPreset, string> = {
  'social-security-number': 'Social security numbers',
  'credit-card-number': 'Credit card numbers',
  'email-address': 'Email addresses',
  'north-american-phone-number': 'Phone numbers (North America)',
  'international-phone-number': 'Phone numbers (international)',
  date: 'Dates',
  url: 'Web addresses',
  ipv4: 'IP addresses (v4)',
  ipv6: 'IP addresses (v6)',
  'mac-address': 'MAC addresses',
  'us-zip-code': 'US ZIP codes',
  vin: 'Vehicle identification numbers',
  time: 'Times',
};

export type Redaction =
  | { strategy: 'preset'; preset: RedactionPreset }
  | { strategy: 'regex'; regex: string; caseSensitive: boolean };

export type RedactionRequestResult =
  | { ok: true; redaction: Redaction }
  | { ok: false; message: string };

/** A Build instruction document, narrowed to what a redaction job sends. */
export type RedactionInstructions = {
  parts: readonly [{ file: string }];
  /** Always exactly two: mark, then apply. */
  actions: readonly [Record<string, unknown>, { type: 'applyRedactions' }];
  output: { type: 'pdf' };
};

const isPreset = (value: unknown): value is RedactionPreset =>
  typeof value === 'string' && REDACTION_PRESETS.includes(value as RedactionPreset);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const parsePreset = (request: Record<string, unknown>): RedactionRequestResult => {
  if (!isPreset(request.preset)) {
    return {
      ok: false,
      message:
        `"${String(request.preset)}" is not a redaction preset this deployment offers. ` +
        `Available presets are: ${REDACTION_PRESETS.join(', ')}.`,
    };
  }

  return { ok: true, redaction: { strategy: 'preset', preset: request.preset } };
};

const parseRegex = (request: Record<string, unknown>): RedactionRequestResult => {
  const { regex, caseSensitive } = request;

  if (typeof regex !== 'string' || regex.length === 0) {
    return {
      ok: false,
      message: 'A regex redaction needs a non-empty "regex" pattern to search for.',
    };
  }

  try {
    new RegExp(regex);
  } catch {
    // Compiled here only to reject an obviously broken pattern early. JavaScript
    // and the API's engine are not the same dialect, so this catches typos, not
    // every incompatibility.
    return {
      ok: false,
      message: `"${regex}" is not a valid regular expression.`,
    };
  }

  return {
    ok: true,
    redaction: { strategy: 'regex', regex, caseSensitive: caseSensitive === true },
  };
};

/**
 * Validate what a caller asked to redact.
 *
 * Returns a result rather than throwing because every caller is a route that
 * has to turn a bad request into a 400 with a readable message.
 */
export const parseRedactionRequest = (raw: unknown): RedactionRequestResult => {
  const request = asRecord(raw);

  if (!request) {
    return { ok: false, message: 'A redaction must be an object naming a strategy.' };
  }

  if (request.strategy === 'preset') {
    return parsePreset(request);
  }

  if (request.strategy === 'regex') {
    return parseRegex(request);
  }

  if (request.strategy === 'ai') {
    return {
      ok: false,
      message:
        'AI redaction is not offered. Redaction here is deterministic — use "preset" or ' +
        '"regex" — so that what was removed can be verified rather than trusted.',
    };
  }

  return {
    ok: false,
    message: `"${String(request.strategy)}" is not a redaction strategy. Use "preset" or "regex".`,
  };
};

/**
 * Turn a validated redaction into the Build instructions that perform it.
 *
 * `filePartName` must match the multipart field the file is uploaded under, or
 * the API answers `file_not_found` — the reference name and the field name are
 * one fact and so are passed together.
 */
export const buildRedactionInstructions = (options: {
  filePartName: string;
  redaction: Redaction;
}): RedactionInstructions => {
  const { filePartName, redaction } = options;

  const strategyOptions =
    redaction.strategy === 'preset'
      ? { preset: redaction.preset }
      : { regex: redaction.regex, caseSensitive: redaction.caseSensitive };

  return {
    parts: [{ file: filePartName }],
    actions: [
      { type: 'createRedactions', strategy: redaction.strategy, strategyOptions },
      // Without this the text is merely covered, not removed. See the note at
      // the top of this file.
      { type: 'applyRedactions' },
    ],
    output: { type: 'pdf' },
  };
};

export const redactionOperation: DocumentOperation = {
  kind: 'REDACTION',
  label: 'Redact',
  description: 'Permanently remove matching text.',
  backends: ['dws', 'document-engine'],
  fields: [{ kind: 'preset-or-regex', name: 'redaction', label: 'What to redact' }],
  parse: (raw) => {
    const request = parseRedactionRequest(raw);

    if (!request.ok) {
      return { ok: false, message: request.message };
    }

    return {
      ok: true,
      outputSuffix: 'redacted',
      buildInstructions: ({ filePartName }) =>
        buildRedactionInstructions({ filePartName, redaction: request.redaction }),
    };
  },
};
