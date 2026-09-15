// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const listMentions = vi.fn();
const markMentionsRead = vi.fn();

vi.mock('@/lib/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/mention-feed', () => ({
  listMentions: (...a: unknown[]) => listMentions(...a),
  markMentionsRead: (...a: unknown[]) => markMentionsRead(...a),
}));

const { GET, POST } = await import('@/app/api/mentions/route');

const get = () => GET(new Request('https://example.test/api/mentions') as never);

const post = (body: unknown) =>
  POST(
    new Request('https://example.test/api/mentions', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }) as never
  );

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ user: { id: 'user_jon', email: 'jon@nutrient.io' } });
  listMentions.mockResolvedValue({ mentions: [], unread: 0 });
  markMentionsRead.mockResolvedValue({ read: 1 });
});

describe('Reading the feed', () => {
  it('returns the caller’s mentions and unread count', async () => {
    listMentions.mockResolvedValue({ mentions: [{ id: 'mention_1' }], unread: 1 });

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mentions: [{ id: 'mention_1' }], unread: 1 });
  });

  // The identity comes from the session and never from the request, or the feed
  // would be a way to read somebody else's mentions.
  it('asks only for the signed-in user’s mentions', async () => {
    await get();

    expect(listMentions).toHaveBeenCalledWith({ userId: 'user_jon' });
  });

  it('answers 401 when nobody is signed in', async () => {
    requireAuth.mockRejectedValue(new Error('Authentication required'));

    expect((await get()).status).toBe(401);
  });
});

describe('Marking mentions read', () => {
  it('marks the named mentions', async () => {
    const response = await post({ mentionIds: ['mention_1', 'mention_2'] });

    expect(response.status).toBe(200);
    expect(markMentionsRead).toHaveBeenCalledWith({
      userId: 'user_jon',
      mentionIds: ['mention_1', 'mention_2'],
    });
  });

  it('marks everything when no ids are named', async () => {
    await post({});

    expect(markMentionsRead).toHaveBeenCalledWith({ userId: 'user_jon', mentionIds: undefined });
  });

  it('scopes to the signed-in user, never to anything in the body', async () => {
    await post({ mentionIds: ['mention_1'], userId: 'user_someone_else' });

    expect(markMentionsRead).toHaveBeenCalledWith({
      userId: 'user_jon',
      mentionIds: ['mention_1'],
    });
  });

  it('refuses ids that are not strings', async () => {
    const response = await post({ mentionIds: [1, 2, 3] });

    expect(response.status).toBe(400);
    expect(markMentionsRead).not.toHaveBeenCalled();
  });

  it('tolerates a missing body', async () => {
    const response = await POST(
      new Request('https://example.test/api/mentions', { method: 'POST' }) as never
    );

    expect(response.status).toBe(200);
  });

  it('answers 401 when nobody is signed in', async () => {
    requireAuth.mockRejectedValue(new Error('Authentication required'));

    expect((await post({})).status).toBe(401);
  });
});
