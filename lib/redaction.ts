/**
 * What a redaction job asks the Processor API to do.
 *
 * Redaction is the first Processor operation this app performs, so this module
 * carries the shape of a Build instruction as well as the rules for one
 * particular action. Both belong together until there is a second operation to
 * generalise against — an abstraction invented ahead of its second caller tends
 * to be the wrong one.
 *
 * **The action is a single `redaction` step, not a create/apply pair.** The Web
 * SDK and Document Engine model redaction as `createRedactions` followed by
 * `applyRedactions`; the Processor API does not, and sending that pair here is
 * rejected. The shapes are close enough to look interchangeable and are not.
 *
 * **AI redaction is deliberately not offered.** The API supports an
 * `ai_redaction` action taking natural-language criteria, and it is the wrong
 * thing to demonstrate: a live model pass that misses a social security number
 * is a compliance claim, made silently, in a reference implementation someone
 * will copy. Preset and regex redaction are deterministic and a reader can
 * verify what they did. `parseRedactionRequest` refuses `ai` explicitly rather
 * than by omission, so the refusal is legible.
 */

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

export type Redaction =
  | { strategy: 'preset'; preset: RedactionPreset }
  | { strategy: 'regex'; regex: string; caseSensitive: boolean };

export type RedactionRequestResult =
  | { ok: true; redaction: Redaction }
  | { ok: false; message: string };

/** A Build instruction document, narrowed to what a redaction job sends. */
export type RedactionInstructions = {
  parts: readonly [{ file: string }];
  actions: readonly [Record<string, unknown>];
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

  const action =
    redaction.strategy === 'preset'
      ? { type: 'redaction', strategy: 'preset', preset: redaction.preset }
      : {
          type: 'redaction',
          strategy: 'regex',
          regex: redaction.regex,
          caseSensitive: redaction.caseSensitive,
        };

  return {
    parts: [{ file: filePartName }],
    actions: [action],
    output: { type: 'pdf' },
  };
};
