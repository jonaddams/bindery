/**
 * How to open a document, given which backend is storing it.
 *
 * The provider seam in `lib/document-provider.ts` ends at the server, and this
 * is where the same choice crosses to the browser. It has to: DWS and Document
 * Engine want genuinely different `NutrientViewer.load()` calls, not the same
 * call with different values.
 *
 * | | DWS | Document Engine |
 * | --- | --- | --- |
 * | credential | `session` | `authPayload.jwt` |
 * | which document | named inside the session | `documentId` |
 * | where the server is | implied | `serverUrl` |
 *
 * Sending a Document Engine JWT as `session` is not a loud failure — the viewer
 * just never loads — so keeping the two shapes apart is worth a function of its
 * own rather than a conditional buried in a `useEffect`.
 */

import type { NutrientTarget } from '@/lib/nutrient-config';

export type ViewerLoadOptions = {
  container: HTMLElement;
  session?: string;
  documentId?: string;
  authPayload?: { jwt: string };
  serverUrl?: string;
  instant?: boolean;
  useCDN?: boolean;
  mentionableUsers?: NutrientMentionableUser[];
};

export type ViewerLoadInput = {
  container: HTMLElement;
  target: NutrientTarget;
  /** Where the *browser* reaches Document Engine. Unused by DWS. */
  serverUrl: string | null;
  documentId: string;
  sessionToken: string;
  mentionableUsers?: NutrientMentionableUser[];
};

export const viewerLoadOptions = (input: ViewerLoadInput): ViewerLoadOptions => {
  const { container, target, serverUrl, documentId, sessionToken, mentionableUsers } = input;

  if (target === 'document-engine') {
    if (!serverUrl) {
      throw new Error(
        'Document Engine needs a serverUrl and none was given. Left to itself the SDK ' +
          'infers one from where its own script was served — the Nutrient CDN — so the ' +
          "browser would look for this deployment's documents on Nutrient's servers. " +
          'Set NUTRIENT_BASE_URL to the URL the browser can reach the engine on.'
      );
    }

    return {
      container,
      documentId,
      authPayload: { jwt: sessionToken },
      // Instant is how Document Engine syncs annotations and comments between
      // readers. Without it the viewer opens but nothing a reader writes is
      // persisted back, which is the app's whole point.
      instant: true,
      // The SDK rejects a URL without a trailing slash outright, and says so:
      // "`serverUrl` must have a slash at the end". `NUTRIENT_BASE_URL` is
      // deliberately an origin *without* one, because every server-side call
      // site appends its own path — so the slash is added here rather than by
      // relaxing that rule and risking `//api/documents` everywhere else.
      serverUrl: serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`,
      // The document comes from the engine; the SDK's own assets still come from
      // the CDN, same as the DWS path. Saying so explicitly silences a
      // deprecation warning about auto-detection going away.
      useCDN: true,
      mentionableUsers,
    };
  }

  return {
    container,
    // A DWS session token names the document it is good for, so there is nothing
    // else to pass.
    session: sessionToken,
    useCDN: true,
    mentionableUsers,
  };
};
