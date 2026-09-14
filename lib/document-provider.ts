/**
 * One way to talk to a document backend, whichever backend this deployment uses.
 *
 * A customer may run the hosted **DWS API** or their own **Document Engine**.
 * The two are close on the Processor surface and noticeably different on this
 * one — different paths, different authentication, and credits on the hosted one
 * only — so the app talks to this type and `lib/nutrient-config.ts` decides
 * which implementation answers.
 *
 * Before this, every endpoint was assembled at its call site from a base URL
 * whose meaning varied, and the sessions endpoint was hardcoded to
 * api.nutrient.io, so pointing the app at a self-hosted engine was impossible
 * regardless of configuration. Paths are now derived in one place from one
 * origin.
 *
 * **There is deliberately no Document Engine implementation yet.** Writing one
 * without an engine to test against would ship guesswork that *looks* like
 * support, which is worse than an honest refusal: the failure would surface as
 * subtly wrong requests at a customer site rather than at startup here. The
 * seam is what was expensive to retrofit, and the seam is what this provides.
 *
 * The type covers what the app does today, and it now spans **both** Nutrient
 * product surfaces, because a processing job needs both: `downloadDocument` and
 * `uploadDocument` are Viewer API calls, `processDocument` is a Processor API
 * call, and they take different keys. One provider rather than two, because from
 * the app's side "do this to that document" is one job, and splitting it would
 * push the two-keys detail out to every caller.
 */

import { type NutrientConfig, type NutrientTarget, nutrientConfig } from '@/lib/nutrient-config';
import { processorApiKey, viewerApiKey } from '@/lib/nutrient-key';

export type DocumentUpload = {
  documentId: string;
  /** May be empty: the viewer can mint its own session later. */
  sessionToken: string;
};

export type ViewerSession = {
  documentId: string;
  sessionToken: string;
};

/**
 * A Build instruction document: what to do, to which uploaded part, producing what.
 *
 * Deliberately loose here. The provider's job is to carry instructions to the
 * backend and bytes back; what constitutes a valid instruction is the operation's
 * own business, and `lib/redaction.ts` owns that for the one operation there is.
 * Typing every action the Processor API offers would be a large speculative
 * surface with one caller.
 */
export type ProcessInstructions = {
  parts: readonly { file: string }[];
  actions: readonly Record<string, unknown>[];
  output?: Record<string, unknown>;
};

export type DocumentProvider = {
  readonly target: NutrientTarget;
  uploadDocument(options: { file: File }): Promise<DocumentUpload>;
  /**
   * Read a stored document's bytes back, so they can be worked on.
   *
   * A processing job needs the original file, and the backend is the only place
   * it exists — the app stores metadata, never content.
   */
  downloadDocument(options: { documentId: string }): Promise<ArrayBuffer>;
  /**
   * Run a Build instruction over a file and return the finished document.
   *
   * **Synchronous, and that is a property of the API, not of this method.**
   * `POST /build` returns the finished file in the response body: there is no
   * job id, no polling and no webhook, so a large operation holds the connection
   * open for as long as the work takes. Everything asynchronous about a job in
   * this app — queueing, status, retry — is ours, built on top of this.
   */
  processDocument(options: {
    source: Uint8Array<ArrayBuffer>;
    filename: string;
    instructions: ProcessInstructions;
  }): Promise<ArrayBuffer>;
  /**
   * `userId` is the app's own user ID. The backend records it as `createdBy` on
   * anything the reader authors in the viewer, which is what ties a comment back
   * to an account. Omitted when no user is known, e.g. during upload.
   */
  createViewerSession(options: { documentId: string; userId?: string }): Promise<ViewerSession>;
  deleteDocument(options: { documentId: string }): Promise<void>;
};

const SESSION_LIFETIME_SECONDS = 24 * 60 * 60;

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  typeof value === 'object' && value !== null ? (value as JsonRecord) : {};

/**
 * Pull a string out of a parsed response body, tolerating the shapes DWS uses.
 *
 * The token in particular arrives as `jwt`, not `session_token` or `token`; the
 * other spellings are read because they have been seen on other endpoints and
 * costing a whole session to a renamed field is not worth the strictness.
 */
const readString = (body: JsonRecord, paths: readonly string[]): string | undefined => {
  for (const path of paths) {
    const value = path.split('.').reduce<unknown>((current, key) => asRecord(current)[key], body);

    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
};

/**
 * Turn a Processor API failure into something a reader can act on.
 *
 * Worth the effort because this API, unlike the Viewer one, says precisely what
 * was wrong: a 400 names the failing path in the instructions. Flattening that
 * to a status code would discard the one detail that distinguishes a fixable
 * job from an opaque one.
 *
 * A 403 is called out by name because it is the failure that keeps recurring
 * here, always for the same reason — the two keys are easy to swap and the API
 * does not say which one it wanted.
 */
const describeProcessorFailure = async (response: Response): Promise<string> => {
  const raw = await response.text();

  if (response.status === 403) {
    return (
      'Processing was refused with 403 Forbidden. This almost always means the viewer key ' +
      'was sent instead of the processor key — check NUTRIENT_PROCESSOR_API_KEY.'
    );
  }

  const failingPaths = (() => {
    try {
      const error = asRecord(asRecord(JSON.parse(raw)).error);
      const paths = error.failingPaths;

      if (!Array.isArray(paths)) {
        return undefined;
      }

      return paths
        .map((entry) => {
          const { path, details } = asRecord(entry);
          return `${String(path)} ${String(details)}`;
        })
        .join('; ');
    } catch {
      return undefined;
    }
  })();

  if (failingPaths) {
    return `Processing failed: ${response.status} - ${failingPaths}`;
  }

  return `Processing failed: ${response.status} - ${raw}`;
};

const createDwsProvider = (config: NutrientConfig): DocumentProvider => {
  const documentsUrl = `${config.baseUrl}/viewer/documents`;
  const sessionsUrl = `${config.baseUrl}/viewer/sessions`;
  // The Processor API sits at the same origin but outside /viewer, and takes the
  // other key. One origin, two product surfaces.
  const buildUrl = `${config.baseUrl}/build`;

  const authorization = (): string => `Bearer ${viewerApiKey()}`;

  const signal = (): AbortSignal => AbortSignal.timeout(config.limits.requestTimeoutMs);

  const createViewerSession = async (options: {
    documentId: string;
    userId?: string;
  }): Promise<ViewerSession> => {
    const { documentId, userId } = options;

    const response = await fetch(sessionsUrl, {
      method: 'POST',
      headers: {
        Authorization: authorization(),
        // DWS answers a wildcard Accept header with HTTP 406.
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        allowed_documents: [
          {
            document_id: documentId,
            // `permissions`, not `document_permissions`: the latter is accepted
            // without complaint and then ignored, so the wrong key leaves the
            // session on defaults instead of failing loudly. Write access is
            // what lets the reader add comments.
            permissions: ['read', 'write'],
          },
        ],
        exp: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
        ...(userId ? { user_id: userId } : {}),
      }),
      signal: signal(),
    });

    if (!response.ok) {
      throw new Error(`Viewer session refused: ${response.status} - ${await response.text()}`);
    }

    const body = asRecord(await response.json());
    const sessionToken = readString(body, [
      'jwt',
      'token',
      'data.session_token',
      'data.sessionToken',
      'sessionToken',
    ]);

    if (!sessionToken) {
      throw new Error(`Viewer session carried no token. Response was: ${JSON.stringify(body)}`);
    }

    return { documentId, sessionToken };
  };

  return {
    target: 'dws',

    async uploadDocument(options: { file: File }): Promise<DocumentUpload> {
      const { file } = options;

      const response = await fetch(documentsUrl, {
        method: 'POST',
        headers: {
          Authorization: authorization(),
          'Content-Type': file.type,
        },
        body: await file.arrayBuffer(),
        signal: signal(),
      });

      if (!response.ok) {
        throw new Error(`Document upload failed: ${response.status} - ${await response.text()}`);
      }

      const body = asRecord(await response.json());
      const documentId = readString(body, ['data.document_id', 'document_id']);

      if (!documentId) {
        throw new Error(`Upload returned no document ID. Response was: ${JSON.stringify(body)}`);
      }

      const sessionToken = readString(body, ['data.session_token', 'sessionToken']);

      if (sessionToken) {
        return { documentId, sessionToken };
      }

      // A session is a convenience here, not the point of the upload, so a
      // refusal must not lose the document that was just stored.
      try {
        const session = await createViewerSession({ documentId });
        return { documentId, sessionToken: session.sessionToken };
      } catch {
        return { documentId, sessionToken: '' };
      }
    },

    createViewerSession,

    async downloadDocument(options: { documentId: string }): Promise<ArrayBuffer> {
      // `/pdf` is not a guess and not documented. Probing the live API, the bare
      // document URL and every other spelling tried — /file, /download, /content
      // — answered 404; this one answers 200 with application/pdf.
      const response = await fetch(`${documentsUrl}/${options.documentId}/pdf`, {
        headers: { Authorization: authorization() },
        signal: signal(),
      });

      if (!response.ok) {
        throw new Error(`Document download failed: ${response.status} - ${await response.text()}`);
      }

      return response.arrayBuffer();
    },

    async processDocument(options: {
      source: Uint8Array<ArrayBuffer>;
      filename: string;
      instructions: ProcessInstructions;
    }): Promise<ArrayBuffer> {
      const { source, filename, instructions } = options;

      const body = new FormData();
      body.set('instructions', JSON.stringify(instructions));

      // The multipart field name must equal the name `parts` references, or the
      // API answers file_not_found. The instructions are the authority on it, so
      // it is read from them rather than passed alongside and kept in step by hand.
      const partName = instructions.parts[0]?.file ?? 'document';
      body.set(partName, new File([source], filename, { type: 'application/pdf' }));

      const response = await fetch(buildUrl, {
        method: 'POST',
        // No Content-Type: fetch sets it, with the multipart boundary. Setting it
        // by hand omits the boundary and the request cannot be parsed.
        headers: { Authorization: `Bearer ${processorApiKey()}` },
        body,
        signal: signal(),
      });

      if (response.ok) {
        return response.arrayBuffer();
      }

      throw new Error(await describeProcessorFailure(response));
    },

    async deleteDocument(options: { documentId: string }): Promise<void> {
      const response = await fetch(`${documentsUrl}/${options.documentId}`, {
        method: 'DELETE',
        headers: { Authorization: authorization() },
        signal: signal(),
      });

      if (response.ok) {
        return;
      }

      // Not every plan permits deletion. Treat "this backend will not do that"
      // as done rather than as an error, so the app's own record can still go.
      if (response.status === 405 || response.status === 501) {
        return;
      }

      throw new Error(`Document delete failed: ${response.status} - ${await response.text()}`);
    },
  };
};

/**
 * The provider for the running process.
 *
 * Built per call rather than cached at module load: resolving the API key throws
 * when it is absent, and that must not happen during a build, where no key is
 * configured and none is needed.
 */
export const documentProvider = (): DocumentProvider => {
  const config = nutrientConfig();

  if (config.target === 'document-engine') {
    throw new Error(
      'NUTRIENT_TARGET is "document-engine", but no Document Engine client is implemented yet. ' +
        'It needs its own paths (/api/documents rather than /viewer/documents), its own token ' +
        'authentication, and locally signed viewer JWTs instead of a session endpoint. ' +
        'Set NUTRIENT_TARGET=dws to use the hosted API.'
    );
  }

  return createDwsProvider(config);
};
