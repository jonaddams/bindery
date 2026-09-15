/**
 * The in-app view of being mentioned.
 *
 * The third delivery channel, behind the same mentions the email and SMS
 * notifiers read. It matters most for the person who has opted out of both
 * others: today they are mentioned and told nothing at all, anywhere.
 *
 * It is only honest now that `/api/cron/sweep-mentions` exists. Before that, a
 * `CommentMention` row appeared only when somebody opened the document, so a
 * feed would have shown a mention long after the fact or never — and a panel
 * that silently misses notifications is worse than no panel, because it invites
 * trust it cannot honour.
 *
 * ## No comment text, and not for privacy
 *
 * The obvious objection to putting comment text in an SMS is the lock screen,
 * and it does not apply here: the feed is behind authentication, and being
 * mentioned grants read access to the document anyway, so the reader could open
 * it and see the comment regardless.
 *
 * The reason is cost. `ObservedComment` stores a `dwsCommentId` and no text,
 * deliberately — DWS is the one source of truth for comment bodies, and
 * `lib/comment-sync.ts` re-reads them per thread rather than duplicating them
 * into Postgres. Rendering text here would mean a DWS fetch per thread on every
 * dashboard load, which is slow and billed. Showing it would mean caching the
 * text, which reverses that decision and deserves its own argument rather than
 * arriving as a side effect of building a list.
 *
 * So the feed says who mentioned you and where. The document is one click away
 * and holds the content.
 */

import { prisma } from '@/lib/prisma';

/** One page of the feed. Enough to be useful, small enough to stay one query. */
export const MENTION_FEED_LIMIT = 20;

export type FeedMention = {
  id: string;
  authorName: string;
  documentId: string;
  documentTitle: string;
  /** ISO 8601, so the client can render it in the reader's own locale. */
  createdAt: string;
  read: boolean;
};

export type MentionFeed = {
  mentions: FeedMention[];
  unread: number;
};

export const listMentions = async (options: { userId: string }): Promise<MentionFeed> => {
  const { userId } = options;

  const [rows, unread] = await Promise.all([
    prisma.commentMention.findMany({
      where: { mentionedUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: MENTION_FEED_LIMIT,
      select: {
        id: true,
        createdAt: true,
        readAt: true,
        comment: {
          select: {
            // `authorUserId` carries no foreign key on purpose: a comment's
            // author may have no account at all — an emailed reply from a
            // stranger, say — so the name is resolved separately rather than
            // joined, exactly as lib/comment-sync.ts does.
            authorUserId: true,
            thread: { select: { document: { select: { id: true, title: true } } } },
          },
        },
      },
    }),
    prisma.commentMention.count({ where: { mentionedUserId: userId, readAt: null } }),
  ]);

  const authorIds = [
    ...new Set(rows.map((row) => row.comment.authorUserId).filter((id) => id !== null)),
  ];

  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true, email: true },
  });

  const displayNameOf = new Map(authors.map((user) => [user.id, user.name ?? user.email]));

  return {
    mentions: rows.map((row) => ({
      id: row.id,
      // A comment can have no author on record, and the feed still has to render.
      authorName: displayNameOf.get(row.comment.authorUserId ?? '') ?? 'Someone',
      documentId: row.comment.thread.document.id,
      documentTitle: row.comment.thread.document.title,
      createdAt: row.createdAt.toISOString(),
      read: row.readAt !== null,
    })),
    unread,
  };
};

/**
 * Mark mentions read: the given ones, or every unread one when none are named.
 *
 * **Reading is explicit.** Opening the document does not mark anything read,
 * which was the friendlier alternative and the wrong one: it marks things read
 * that were never seen, and an unread count nobody can trust is worse than none.
 *
 * `mentionedUserId` is in the filter on every path. The ids come from the
 * browser, so without it anyone could mark anyone else's mentions read — which
 * would be a way to hide a mention from its recipient.
 */
export const markMentionsRead = async (options: {
  userId: string;
  mentionIds?: string[];
}): Promise<{ read: number }> => {
  const { userId, mentionIds } = options;

  // An empty list means "these zero mentions", not "all of them". Treating it as
  // absent would silently clear the whole feed.
  if (mentionIds?.length === 0) {
    return { read: 0 };
  }

  const result = await prisma.commentMention.updateMany({
    where: {
      mentionedUserId: userId,
      // Already-read mentions are left alone: when it was *first* read is the
      // fact worth keeping.
      readAt: null,
      ...(mentionIds ? { id: { in: mentionIds } } : {}),
    },
    data: { readAt: new Date() },
  });

  return { read: result.count };
};
