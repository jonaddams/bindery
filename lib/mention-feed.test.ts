// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const findManyMentions = vi.fn();
const countMentions = vi.fn();
const updateManyMentions = vi.fn();
const findManyUsers = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commentMention: {
      findMany: (...a: unknown[]) => findManyMentions(...a),
      count: (...a: unknown[]) => countMentions(...a),
      updateMany: (...a: unknown[]) => updateManyMentions(...a),
    },
    user: { findMany: (...a: unknown[]) => findManyUsers(...a) },
  },
}));

const { MENTION_FEED_LIMIT, listMentions, markMentionsRead } = await import('@/lib/mention-feed');

const aRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'mention_1',
  createdAt: new Date('2026-09-15T15:15:15Z'),
  readAt: null,
  comment: {
    authorUserId: 'user_bryan',
    thread: {
      document: { id: 'doc_1', title: 'Q3 Contract' },
    },
  },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  findManyMentions.mockResolvedValue([aRow()]);
  countMentions.mockResolvedValue(1);
  updateManyMentions.mockResolvedValue({ count: 1 });
  findManyUsers.mockResolvedValue([
    { id: 'user_bryan', name: 'Bryan Rust', email: 'bryan@nutrient.io' },
  ]);
});

describe('listing someone’s mentions', () => {
  it('returns only their own', async () => {
    await listMentions({ userId: 'user_jon' });

    expect(findManyMentions.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ mentionedUserId: 'user_jon' })
    );
  });

  it('shows the newest first', async () => {
    await listMentions({ userId: 'user_jon' });

    expect(findManyMentions.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('bounds the page', async () => {
    await listMentions({ userId: 'user_jon' });

    expect(findManyMentions.mock.calls[0][0].take).toBe(MENTION_FEED_LIMIT);
  });

  it('says who mentioned them, where, and whether it is unread', async () => {
    const result = await listMentions({ userId: 'user_jon' });

    expect(result.mentions[0]).toEqual({
      id: 'mention_1',
      authorName: 'Bryan Rust',
      documentId: 'doc_1',
      documentTitle: 'Q3 Contract',
      createdAt: '2026-09-15T15:15:15.000Z',
      read: false,
    });
  });

  it('falls back to the author’s email when they have no name', async () => {
    findManyUsers.mockResolvedValue([{ id: 'user_bryan', name: null, email: 'bryan@nutrient.io' }]);

    const result = await listMentions({ userId: 'user_jon' });

    expect(result.mentions[0].authorName).toBe('bryan@nutrient.io');
  });

  // A comment can have no author on record — an emailed reply from someone with
  // no account, for instance. The feed still has to render.
  it('survives a comment with no author on record', async () => {
    findManyMentions.mockResolvedValue([
      aRow({
        comment: {
          authorUserId: null,
          thread: { document: { id: 'doc_1', title: 'Q3 Contract' } },
        },
      }),
    ]);

    const result = await listMentions({ userId: 'user_jon' });

    expect(result.mentions[0].authorName).toBe('Someone');
  });

  it('counts only the unread ones', async () => {
    countMentions.mockResolvedValue(4);

    const result = await listMentions({ userId: 'user_jon' });

    expect(countMentions.mock.calls[0][0].where).toEqual({
      mentionedUserId: 'user_jon',
      readAt: null,
    });
    expect(result.unread).toBe(4);
  });

  it('reports a mention already read as read', async () => {
    findManyMentions.mockResolvedValue([aRow({ readAt: new Date('2026-09-15T16:00:00Z') })]);

    const result = await listMentions({ userId: 'user_jon' });

    expect(result.mentions[0].read).toBe(true);
  });
});

describe('marking mentions read', () => {
  // The scoping is the security property: an id is supplied by the browser, so
  // without the user in the filter anyone could mark anyone else's mentions read.
  it('only ever touches the caller’s own mentions', async () => {
    await markMentionsRead({ userId: 'user_jon', mentionIds: ['mention_1'] });

    expect(updateManyMentions.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ mentionedUserId: 'user_jon', id: { in: ['mention_1'] } })
    );
  });

  it('stamps when it was read', async () => {
    await markMentionsRead({ userId: 'user_jon', mentionIds: ['mention_1'] });

    expect(updateManyMentions.mock.calls[0][0].data.readAt).toBeInstanceOf(Date);
  });

  // Re-marking must not move the timestamp: when it was first read is the fact
  // worth keeping.
  it('leaves an already-read mention alone', async () => {
    await markMentionsRead({ userId: 'user_jon', mentionIds: ['mention_1'] });

    expect(updateManyMentions.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ readAt: null })
    );
  });

  it('marks everything unread when given no ids', async () => {
    await markMentionsRead({ userId: 'user_jon' });

    const { where } = updateManyMentions.mock.calls[0][0];
    expect(where.mentionedUserId).toBe('user_jon');
    expect(where.id).toBeUndefined();
  });

  it('reports how many it changed', async () => {
    updateManyMentions.mockResolvedValue({ count: 3 });

    expect(await markMentionsRead({ userId: 'user_jon' })).toEqual({ read: 3 });
  });

  it('does nothing when handed an empty list, rather than marking everything', async () => {
    const result = await markMentionsRead({ userId: 'user_jon', mentionIds: [] });

    expect(updateManyMentions).not.toHaveBeenCalled();
    expect(result).toEqual({ read: 0 });
  });
});
