/**
 * Which key opens which Nutrient API.
 *
 * A Nutrient account issues more than one key, one per product surface, and they
 * are **not interchangeable in either direction**. Both start with `pdf_live_`
 * and are the same length, so they are easy to swap by mistake, and the symptom
 * is always an opaque `403` rather than anything naming the real problem:
 *
 * - the Processor key answers `403 Forbidden` to every Viewer request, including
 *   ones that name no document at all;
 * - the Viewer key answers `403 Forbidden` to `POST /build`.
 *
 * Both directions are confirmed against the live API rather than inferred.
 *
 * The app needs both, because a processing job spans the two surfaces: it
 * downloads the source and re-uploads the result through the Viewer API, and
 * does the work in between through the Processor API.
 *
 * Resolved in one place because "which variable holds the key" is a single fact.
 * It was previously repeated at each call site, which is how they came to disagree.
 */

export type NutrientKeyEnv = {
  NUTRIENT_VIEWER_API_KEY?: string;
  /** The name used before the keys were split by product surface. */
  NUTRIENT_API_KEY?: string;
  /** Opens the Processor API — `POST /build` — and nothing on the Viewer surface. */
  NUTRIENT_PROCESSOR_API_KEY?: string;
};

export const resolveViewerApiKey = (env: NutrientKeyEnv): string => {
  // Falls back so an environment still carrying the single old name keeps
  // working across the rename rather than failing on deploy.
  const apiKey = env.NUTRIENT_VIEWER_API_KEY || env.NUTRIENT_API_KEY;

  if (!apiKey) {
    throw new Error(
      'No Nutrient Viewer API key configured: set NUTRIENT_VIEWER_API_KEY. ' +
        'Note this is not the Processor key — that one cannot reach the Viewer API.'
    );
  }

  return apiKey;
};

/**
 * Which key opens the Nutrient Processor API.
 *
 * Deliberately has **no fallback**, which is the one way it differs from
 * `resolveViewerApiKey`. The two keys are not interchangeable in either
 * direction: confirmed against the live API, the viewer key answers `POST /build`
 * with `403 Forbidden`, exactly mirroring the processor key's 403 on every Viewer
 * request. So falling back to whatever other key happened to be configured would
 * trade a clear "set this variable" error at startup for an opaque Forbidden
 * mid-job, which is the more expensive failure and the harder one to read.
 */
export const resolveProcessorApiKey = (env: NutrientKeyEnv): string => {
  const apiKey = env.NUTRIENT_PROCESSOR_API_KEY;

  if (!apiKey) {
    throw new Error(
      'No Nutrient Processor API key configured: set NUTRIENT_PROCESSOR_API_KEY. ' +
        'Note this is not the Viewer key — that one answers 403 to the Processor API.'
    );
  }

  return apiKey;
};

/** The key as configured in the running process. */
export const viewerApiKey = (): string =>
  resolveViewerApiKey({
    NUTRIENT_VIEWER_API_KEY: process.env.NUTRIENT_VIEWER_API_KEY,
    NUTRIENT_API_KEY: process.env.NUTRIENT_API_KEY,
  });

/** The processor key as configured in the running process. */
export const processorApiKey = (): string =>
  resolveProcessorApiKey({
    NUTRIENT_PROCESSOR_API_KEY: process.env.NUTRIENT_PROCESSOR_API_KEY,
  });
