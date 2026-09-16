/**
 * Comment access, against whichever backend this deployment uses.
 *
 * The backend is the system of record for comment content. Everything here is a
 * thin, typed wrapper over the REST endpoints so the rest of the app never has
 * to remember the payload shapes.
 *
 * **Both DWS and Document Engine are supported, chosen by `NUTRIENT_TARGET`.**
 * They are far more alike than they look, because the DWS Viewer API is built on
 * Document Engine: the request payloads and the response shapes are identical,
 * `user_id` round-trips as `createdBy` on both, and `customData` survives both.
 * Verified against a running engine, not assumed.
 *
 * Only three things actually differ, and only one of them is interesting:
 *
 * - the path (`/viewer/documents` against `/api/documents`);
 * - the credential (a bearer viewer key against `Token token=`);
 * - **creating a thread takes two calls on Document Engine rather than one.**
 *   DWS roots the annotation and writes the first comment in a single POST to
 *   `/comments`; Document Engine has no document-level comments endpoint at all
 *   (it answers 404), so the annotation is created first and the comment
 *   appended to it. That also means thread creation is not atomic there — see
 *   `createCommentThread`.
 *
 * Things about the API that are easy to get wrong, all learned the hard way and
 * all true of both backends:
 *
 * - A wildcard Accept header is answered with HTTP 406, and Node's fetch sends one
 *   by default, so every request here sets `Accept: application/json` explicitly.
 * - A comment thread is rooted on a *markup* annotation carrying
 *   `isCommentThreadRoot: true`. `pspdfkit/comment-marker` is an SDK-side type and
 *   is not accepted by the create endpoint.
 * - `user_id` is the real author. It comes back as `createdBy`. `creatorName` is a
 *   display string only, so both are sent: one for truth, one for the UI.
 */

import { nutrientConfig } from '@/lib/nutrient-config';
import { documentEngineApiToken, viewerApiKey } from '@/lib/nutrient-key';

/**
 * Where the documents live and how to prove we may read them.
 *
 * Resolved per call rather than at module load, for the same reason
 * `documentProvider()` is: resolving a credential throws when it is absent, and
 * that must not happen during a build, where none is configured and none is
 * needed.
 */
const backend = (): { documentsUrl: string; authorization: string; isEngine: boolean } => {
  const config = nutrientConfig();

  if (config.target === 'document-engine') {
    return {
      documentsUrl: `${config.baseUrl}/api/documents`,
      authorization: `Token token=${documentEngineApiToken()}`,
      isEngine: true,
    };
  }

  return {
    documentsUrl: `${config.baseUrl}/viewer/documents`,
    authorization: `Bearer ${viewerApiKey()}`,
    isEngine: false,
  };
};

export type Rect = [left: number, top: number, width: number, height: number];

export type ThreadComment = {
  id: string;
  text: string;
  authorUserId: string | null;
  creatorName: string | null;
  customData: Record<string, unknown> | null;
  createdAt: string | null;
};

type CommentResponse = {
  id?: string;
  createdBy?: string | null;
  content?: {
    text?: { value?: string | null } | null;
    creatorName?: string | null;
    customData?: Record<string, unknown> | null;
    createdAt?: string | null;
  } | null;
};

type AnnotationResponse = {
  id?: string;
  content?: { isCommentThreadRoot?: boolean } | null;
};

/**
 * A backend request that came back not-ok, carrying enough to decide what to do next.
 *
 * The status matters because callers have to tell **gone** from **briefly
 * unwell**, and those want opposite handling: a 404 can never succeed on a
 * retry, while a 503 usually succeeds on the next attempt. Before this the
 * status was only in the message string, so the one caller that needed the
 * distinction would have had to parse our own prose to find it.
 *
 * This is not hypothetical. A stored comment thread whose root annotation had
 * been deleted from the backend made the inbound SMS webhook answer 500 to
 * trigger a Twilio retry — and since the annotation was gone for good, every
 * retry failed the same way and the sender simply never heard back.
 */
export class CommentApiError extends Error {
  readonly status: number;

  /** True when retrying cannot help: the resource is gone or the request is bad. */
  readonly permanent: boolean;

  constructor(options: { path: string; status: number; raw: string }) {
    super(`Comment request to ${options.path} failed: ${options.status} - ${options.raw}`);

    this.name = 'CommentApiError';
    this.status = options.status;
    // 404/410 only. A 401 or 403 is also unretryable, but it means our key is
    // wrong — an outage worth surfacing loudly rather than reporting to a user
    // as though their thread had vanished.
    this.permanent = options.status === 404 || options.status === 410;
  }
}

const request = async (url: string, init: RequestInit = {}): Promise<unknown> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: backend().authorization,
      // Both backends return 406 for a wildcard Accept header.
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new CommentApiError({ path: url, status: response.status, raw });
  }

  return raw ? JSON.parse(raw) : null;
};

/** Smallest rectangle enclosing all of `rects`, as [left, top, width, height]. */
const boundingBoxOf = (rects: Rect[]): Rect => {
  const left = Math.min(...rects.map(([x]) => x));
  const top = Math.min(...rects.map(([, y]) => y));
  const right = Math.max(...rects.map(([x, , width]) => x + width));
  const bottom = Math.max(...rects.map(([, y, , height]) => y + height));

  return [left, top, right - left, bottom - top];
};

const commentBody = (options: {
  authorUserId: string;
  creatorName: string;
  text: string;
  customData?: Record<string, unknown>;
}) => ({
  user_id: options.authorUserId,
  content: {
    text: { format: 'plain', value: options.text },
    creatorName: options.creatorName,
    ...(options.customData ? { customData: options.customData } : {}),
  },
});

const toThreadComment = (comment: CommentResponse): ThreadComment => ({
  id: comment.id ?? '',
  text: comment.content?.text?.value ?? '',
  authorUserId: comment.createdBy ?? null,
  creatorName: comment.content?.creatorName ?? null,
  customData: comment.content?.customData ?? null,
  createdAt: comment.content?.createdAt ?? null,
});

export type CreateCommentThreadOptions = {
  documentId: string;
  authorUserId: string;
  creatorName: string;
  text: string;
  pageIndex: number;
  rects: Rect[];
  customData?: Record<string, unknown>;
};

/**
 * Creates the thread's root annotation and its first comment.
 *
 * **One call on DWS, two on Document Engine**, because the engine has no
 * document-level comments endpoint — `POST /api/documents/{id}/comments` is a
 * 404. So the engine path is not atomic: if the second call fails, a root
 * annotation is left with no comment on it. That is survivable and deliberately
 * not compensated for — `fetchThreadRoots` would report the orphan, and
 * `fetchComments` returns an empty list for it, which reconciliation already
 * treats as "nothing new". Deleting the annotation to tidy up would risk
 * destroying a thread that had in fact been created.
 */
export const createCommentThread = async (
  options: CreateCommentThreadOptions
): Promise<{ rootAnnotationId: string; commentId: string }> => {
  const { documentId, authorUserId, pageIndex, rects } = options;
  const { documentsUrl, isEngine } = backend();

  const annotation = {
    user_id: authorUserId,
    content: {
      type: 'pspdfkit/markup/highlight',
      v: 2,
      pageIndex,
      bbox: boundingBoxOf(rects),
      rects,
      blendMode: 'multiply',
      color: '#FCEE7C',
      opacity: 1,
      isCommentThreadRoot: true,
    },
  };

  if (isEngine) {
    // The engine takes the annotation's fields at the top level. Wrapping them
    // in `annotation`, as DWS requires, is rejected with an error that merely
    // echoes the payload back and says `unknown_error`.
    const created = (await request(`${documentsUrl}/${documentId}/annotations`, {
      method: 'POST',
      body: JSON.stringify(annotation),
    })) as { data?: { annotation_id?: string } };

    const rootAnnotationId = created.data?.annotation_id ?? '';
    const { commentId } = await addComment({ ...options, rootAnnotationId });

    return { rootAnnotationId, commentId };
  }

  const result = (await request(`${documentsUrl}/${documentId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ annotation, comments: [commentBody(options)] }),
  })) as { data?: { annotation?: { id?: string }; comments?: Array<{ id?: string }> } };

  return {
    rootAnnotationId: result.data?.annotation?.id ?? '',
    commentId: result.data?.comments?.[0]?.id ?? '',
  };
};

export type AddCommentOptions = {
  documentId: string;
  rootAnnotationId: string;
  authorUserId: string;
  creatorName: string;
  text: string;
  customData?: Record<string, unknown>;
};

/** Appends a comment to an existing thread. */
export const addComment = async (options: AddCommentOptions): Promise<{ commentId: string }> => {
  const { documentId, rootAnnotationId } = options;

  const result = (await request(
    `${backend().documentsUrl}/${documentId}/annotations/${rootAnnotationId}/comments`,
    { method: 'POST', body: JSON.stringify({ comments: [commentBody(options)] }) }
  )) as { data?: { comments?: Array<{ id?: string }> } };

  return { commentId: result.data?.comments?.[0]?.id ?? '' };
};

export type FetchCommentsOptions = {
  documentId: string;
  rootAnnotationId: string;
};

export const fetchComments = async (options: FetchCommentsOptions): Promise<ThreadComment[]> => {
  const { documentId, rootAnnotationId } = options;

  const result = (await request(
    `${backend().documentsUrl}/${documentId}/annotations/${rootAnnotationId}/comments`,
    { method: 'GET' }
  )) as { data?: { comments?: CommentResponse[] } };

  return (result.data?.comments ?? []).map(toThreadComment);
};

/** Annotation IDs in the document that root a comment thread. */
export const fetchThreadRoots = async (options: { documentId: string }): Promise<string[]> => {
  const result = (await request(`${backend().documentsUrl}/${options.documentId}/annotations`, {
    method: 'GET',
  })) as { data?: { annotations?: AnnotationResponse[] } };

  return (result.data?.annotations ?? [])
    .filter((annotation) => annotation.content?.isCommentThreadRoot === true)
    .map((annotation) => annotation.id)
    .filter((id): id is string => typeof id === 'string');
};
