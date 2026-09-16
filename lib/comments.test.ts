// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addComment, createCommentThread, fetchComments, fetchThreadRoots } from '@/lib/comments';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const mockFetch = (...responses: Response[]) => {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const lastRequest = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return {
    url: String(url),
    method: init?.method,
    headers: init?.headers as Record<string, string>,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
};

beforeEach(() => {
  vi.stubEnv('NUTRIENT_API_KEY', 'test-api-key');
});

const THREAD_ROOT = {
  documentId: 'doc_123',
  authorUserId: 'user_alice',
  creatorName: 'Alice Example',
  text: 'Can we tighten this clause? cc @bob',
  pageIndex: 0,
  rects: [[72, 690, 240, 24]] as Array<[number, number, number, number]>,
};

describe('Starting a comment thread', () => {
  it('anchors the thread to an annotation marked as a thread root', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { annotation: { id: 'anno_1' }, comments: [{ id: 'cmt_1' }] } })
    );

    await createCommentThread(THREAD_ROOT);

    expect(lastRequest(fetchMock).body.annotation.content.isCommentThreadRoot).toBe(true);
  });

  it('records the author so DWS attributes the comment to the right user', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { annotation: { id: 'anno_1' }, comments: [{ id: 'cmt_1' }] } })
    );

    await createCommentThread(THREAD_ROOT);

    const { body } = lastRequest(fetchMock);
    expect(body.annotation.user_id).toBe('user_alice');
    expect(body.comments[0].user_id).toBe('user_alice');
    expect(body.comments[0].content.creatorName).toBe('Alice Example');
  });

  it('returns the identifiers needed to find the thread again', async () => {
    mockFetch(
      jsonResponse({ data: { annotation: { id: 'anno_1' }, comments: [{ id: 'cmt_1' }] } })
    );

    const created = await createCommentThread(THREAD_ROOT);

    expect(created).toEqual({ rootAnnotationId: 'anno_1', commentId: 'cmt_1' });
  });

  it('derives the annotation bounding box from the highlighted rectangles', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { annotation: { id: 'anno_1' }, comments: [{ id: 'cmt_1' }] } })
    );

    await createCommentThread({
      ...THREAD_ROOT,
      rects: [
        [10, 100, 50, 20],
        [10, 130, 90, 20],
      ],
    });

    expect(lastRequest(fetchMock).body.annotation.content.bbox).toEqual([10, 100, 90, 50]);
  });
});

describe('Talking to DWS', () => {
  it('asks for JSON explicitly, because DWS rejects a wildcard Accept header', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { annotation: { id: 'a' }, comments: [{ id: 'c' }] } })
    );

    await createCommentThread(THREAD_ROOT);

    expect(lastRequest(fetchMock).headers.Accept).toBe('application/json');
  });

  it('authenticates with the API key', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { annotation: { id: 'a' }, comments: [{ id: 'c' }] } })
    );

    await createCommentThread(THREAD_ROOT);

    expect(lastRequest(fetchMock).headers.Authorization).toBe('Bearer test-api-key');
  });

  it('reports the failure rather than returning a half-made thread', async () => {
    mockFetch(jsonResponse({ error: { annotation: ['error_parsing_annotation'] } }, 422));

    await expect(createCommentThread(THREAD_ROOT)).rejects.toThrow(/422/);
  });

  // A caller has to tell "the thread is gone" from "DWS is briefly unwell",
  // because one can never succeed on a retry and the other usually does.
  // Reading that out of the message string would be a parser of our own prose.
  it('carries the HTTP status on the error, so a caller can tell gone from unwell', async () => {
    mockFetch(jsonResponse({ error: 'Resource not found.' }, 404));

    await expect(createCommentThread(THREAD_ROOT)).rejects.toMatchObject({ status: 404 });
  });

  it('marks a vanished resource as permanent and a server fault as not', async () => {
    mockFetch(jsonResponse({ error: 'Resource not found.' }, 404));
    await expect(createCommentThread(THREAD_ROOT)).rejects.toMatchObject({ permanent: true });

    mockFetch(jsonResponse({ error: 'oops' }, 503));
    await expect(createCommentThread(THREAD_ROOT)).rejects.toMatchObject({ permanent: false });
  });

  it('refuses to run without an API key', async () => {
    vi.stubEnv('NUTRIENT_API_KEY', '');
    vi.stubEnv('NUTRIENT_VIEWER_API_KEY', '');

    await expect(createCommentThread(THREAD_ROOT)).rejects.toThrow(/NUTRIENT_VIEWER_API_KEY/);
  });

  it('uses the viewer key in preference to the old single-key name', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { annotation: { id: 'anno_1' }, comments: [{ id: 'cmt_1' }] } })
    );
    vi.stubEnv('NUTRIENT_VIEWER_API_KEY', 'viewer-key');

    await createCommentThread(THREAD_ROOT);

    expect(lastRequest(fetchMock).headers.Authorization).toBe('Bearer viewer-key');
  });
});

describe('Replying to an existing thread', () => {
  const REPLY = {
    documentId: 'doc_123',
    rootAnnotationId: 'anno_1',
    authorUserId: 'user_bob',
    creatorName: 'Bob Example',
    text: 'Agreed, softening it now.',
    customData: { source: 'email' },
  };

  it('posts against the thread root rather than creating a new thread', async () => {
    const fetchMock = mockFetch(jsonResponse({ data: { comments: [{ id: 'cmt_2' }] } }));

    await addComment(REPLY);

    expect(lastRequest(fetchMock).url).toContain('/annotations/anno_1/comments');
  });

  it('carries the provenance through so an inbound reply is recognisable later', async () => {
    const fetchMock = mockFetch(jsonResponse({ data: { comments: [{ id: 'cmt_2' }] } }));

    await addComment(REPLY);

    expect(lastRequest(fetchMock).body.comments[0].content.customData).toEqual({ source: 'email' });
  });

  it('returns the new comment id', async () => {
    mockFetch(jsonResponse({ data: { comments: [{ id: 'cmt_2' }] } }));

    await expect(addComment(REPLY)).resolves.toEqual({ commentId: 'cmt_2' });
  });
});

describe('Reading a thread back', () => {
  it('presents each comment with its author and text', async () => {
    mockFetch(
      jsonResponse({
        data: {
          comments: [
            {
              id: 'cmt_1',
              content: {
                text: { value: 'Can we tighten this?', format: 'plain' },
                creatorName: 'Alice Example',
                customData: { mentions: ['user_bob'] },
                createdAt: '2026-08-21T17:41:10.979Z',
              },
              createdBy: 'user_alice',
            },
          ],
        },
      })
    );

    const comments = await fetchComments({ documentId: 'doc_123', rootAnnotationId: 'anno_1' });

    expect(comments).toEqual([
      {
        id: 'cmt_1',
        text: 'Can we tighten this?',
        authorUserId: 'user_alice',
        creatorName: 'Alice Example',
        customData: { mentions: ['user_bob'] },
        createdAt: '2026-08-21T17:41:10.979Z',
      },
    ]);
  });

  it('copes with a thread that has no comments yet', async () => {
    mockFetch(jsonResponse({ data: { comments: [] } }));

    await expect(
      fetchComments({ documentId: 'doc_123', rootAnnotationId: 'anno_1' })
    ).resolves.toEqual([]);
  });
});

describe('Finding the threads in a document', () => {
  it('returns only annotations that are comment thread roots', async () => {
    mockFetch(
      jsonResponse({
        data: {
          annotations: [
            { id: 'anno_plain', content: { type: 'pspdfkit/markup/highlight' } },
            {
              id: 'anno_root',
              content: { type: 'pspdfkit/markup/highlight', isCommentThreadRoot: true },
            },
          ],
        },
      })
    );

    await expect(fetchThreadRoots({ documentId: 'doc_123' })).resolves.toEqual(['anno_root']);
  });

  it('returns nothing for a document nobody has commented on', async () => {
    mockFetch(jsonResponse({ data: { annotations: [] } }));

    await expect(fetchThreadRoots({ documentId: 'doc_123' })).resolves.toEqual([]);
  });
});

/**
 * The same four operations against a self-hosted Document Engine.
 *
 * Verified against a running engine before being written down — see
 * `docker/document-engine/README.md`. The payloads and the response shapes turn
 * out to be identical on both backends, because the DWS Viewer API is built on
 * Document Engine; what differs is the path, the credential, and the fact that
 * creating a thread takes two calls instead of one.
 */
describe('Comments on a Document Engine backend', () => {
  beforeEach(() => {
    vi.stubEnv('NUTRIENT_TARGET', 'document-engine');
    vi.stubEnv('NUTRIENT_BASE_URL', 'http://localhost:5001');
    vi.stubEnv('DOCUMENT_ENGINE_API_TOKEN', 'engine-token');
  });

  it('creates a thread in two calls, because there is no document-level comments endpoint', async () => {
    // DWS roots the annotation and writes the first comment in one POST to
    // /comments. Document Engine answers 404 there, so the annotation is created
    // first and the comment appended to it.
    const fetchMock = mockFetch(
      jsonResponse({ data: { annotation_id: 'anno_engine' } }),
      jsonResponse({ data: { comments: [{ id: 'comment_engine' }] } })
    );

    const result = await createCommentThread(THREAD_ROOT);

    expect(result).toEqual({ rootAnnotationId: 'anno_engine', commentId: 'comment_engine' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [annotationUrl] = fetchMock.mock.calls[0] ?? [];
    expect(String(annotationUrl)).toBe('http://localhost:5001/api/documents/doc_123/annotations');
    expect(String(lastRequest(fetchMock).url)).toBe(
      'http://localhost:5001/api/documents/doc_123/annotations/anno_engine/comments'
    );
  });

  it('sends the annotation without the wrapper DWS requires', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { annotation_id: 'anno_engine' } }),
      jsonResponse({ data: { comments: [{ id: 'comment_engine' }] } })
    );

    await createCommentThread(THREAD_ROOT);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));

    // DWS wants `{annotation: {user_id, content}}`; the engine wants the fields
    // at the top level and rejects the wrapper with an error that merely echoes
    // the payload back, which is a long way to walk for a misplaced key.
    expect(body.annotation).toBeUndefined();
    expect(body.user_id).toBe('user_alice');
    expect(body.content.isCommentThreadRoot).toBe(true);
  });

  it('authenticates with the engine token, not a bearer key', async () => {
    const fetchMock = mockFetch(jsonResponse({ data: { comments: [] } }));

    await fetchComments({ documentId: 'doc_123', rootAnnotationId: 'anno_root' });

    const { url, headers } = lastRequest(fetchMock);

    expect(url).toBe('http://localhost:5001/api/documents/doc_123/annotations/anno_root/comments');
    expect(headers.Authorization).toBe('Token token=engine-token');
    // Both backends answer a wildcard Accept with 406, and Node's fetch sends
    // one by default.
    expect(headers.Accept).toBe('application/json');
  });

  it('appends a comment at the engine path', async () => {
    const fetchMock = mockFetch(jsonResponse({ data: { comments: [{ id: 'comment_2' }] } }));

    const result = await addComment({
      documentId: 'doc_123',
      rootAnnotationId: 'anno_root',
      authorUserId: 'user_bob',
      creatorName: 'Bob Example',
      text: 'Agreed.',
    });

    expect(result).toEqual({ commentId: 'comment_2' });
    expect(lastRequest(fetchMock).url).toBe(
      'http://localhost:5001/api/documents/doc_123/annotations/anno_root/comments'
    );
  });

  it('reads thread roots from the engine, which answers in the DWS shape', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        data: {
          annotations: [
            { id: 'anno_root', content: { isCommentThreadRoot: true } },
            { id: 'anno_plain', content: { isCommentThreadRoot: false } },
          ],
        },
      })
    );

    await expect(fetchThreadRoots({ documentId: 'doc_123' })).resolves.toEqual(['anno_root']);
    expect(lastRequest(fetchMock).url).toBe(
      'http://localhost:5001/api/documents/doc_123/annotations'
    );
  });
});
