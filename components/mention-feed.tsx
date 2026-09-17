'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatRelativeTime } from '@/lib/relative-time';

type Mention = {
  id: string;
  authorName: string;
  documentId: string;
  documentTitle: string;
  createdAt: string;
  read: boolean;
};

/**
 * Where a mention is discoverable in the app, rather than only in an email or a
 * text.
 *
 * It is the channel that works for someone who has opted out of the other two —
 * today they are mentioned and told nothing at all — and the cheap one for
 * volume, since AT&T's A2P throughput is a quarter of a message per second.
 *
 * **It says who and where, not what.** The comment body lives in DWS and is not
 * duplicated into Postgres, so showing it would mean a fetch per thread on every
 * dashboard load. That is a cost decision rather than a privacy one: the reader
 * can open the document and read the comment, since being mentioned granted them
 * access. See `lib/mention-feed.ts`.
 *
 * **Reading is explicit.** Following the link does not mark anything read.
 * Marking on open was the friendlier option and the wrong one — it marks things
 * read that were never looked at, and an unread count nobody can trust is worse
 * than no count.
 */
export function MentionFeed() {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [unread, setUnread] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/mentions');

      if (!response.ok) {
        return;
      }

      const body: { mentions: Mention[]; unread: number } = await response.json();
      setMentions(body.mentions);
      setUnread(body.unread);
    } catch {
      // A feed that fails to load shows nothing rather than an error: it is a
      // secondary surface, and the documents below it are the point of the page.
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (mentionIds?: string[]) => {
    // Optimistic: the request is small and the failure mode is a stale badge
    // until the next load, not lost data.
    setMentions((current) =>
      current.map((mention) =>
        !mentionIds || mentionIds.includes(mention.id) ? { ...mention, read: true } : mention
      )
    );
    setUnread((current) => (mentionIds ? Math.max(0, current - mentionIds.length) : 0));

    try {
      await fetch('/api/mentions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mentionIds ? { mentionIds } : {}),
      });
    } catch {
      void load();
    }
  };

  if (!isLoaded) {
    return null;
  }

  return (
    <div className="bg-background shadow rounded-lg border border-border p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">Mentions</h2>
          {unread > 0 && (
            <span
              data-testid="unread-count"
              className="rounded-full bg-primary text-primary-foreground text-xs font-medium px-2 py-0.5"
            >
              {unread}
            </span>
          )}
        </div>

        {unread > 0 && (
          <button
            type="button"
            onClick={() => markRead()}
            className="text-xs text-primary hover:text-primary-hover transition-colors cursor-pointer"
          >
            Mark all read
          </button>
        )}
      </div>

      {mentions.length === 0 ? (
        <p className="text-xs text-muted">No mentions yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {mentions.map((mention) => (
            <li key={mention.id} className="py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              {!mention.read && (
                <span
                  role="img"
                  aria-label="Unread"
                  className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0"
                />
              )}

              <span className={`text-xs ${mention.read ? 'text-muted' : 'text-foreground'}`}>
                <span className="font-medium">{mention.authorName}</span> mentioned you on
              </span>

              <Link
                href={`/documents/${mention.documentId}`}
                className="text-xs text-primary hover:text-primary-hover transition-colors"
              >
                {mention.documentTitle}
              </Link>

              {/* `title` keeps the exact moment available on hover, since the
                  relative form deliberately loses it. */}
              <time
                className="text-xs text-subtle"
                dateTime={mention.createdAt}
                title={new Date(mention.createdAt).toLocaleString()}
              >
                {formatRelativeTime({ iso: mention.createdAt })}
              </time>

              {!mention.read && (
                <button
                  type="button"
                  onClick={() => markRead([mention.id])}
                  className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer ml-auto"
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
