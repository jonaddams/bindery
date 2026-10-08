'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/bindery/avatar';
import { BI } from '@/components/bindery/icons';
import { formatRelativeTime } from '@/lib/relative-time';
import { announceUnreadMentions } from '@/lib/unread-mentions';

type Mention = {
  id: string;
  authorName: string;
  documentId: string;
  documentTitle: string;
  createdAt: string;
  read: boolean;
};

type MentionFeedProps = {
  /**
   * `card` is the dashboard nudge — unread only, at most two, and nothing at
   * all when there is nothing new. `inbox` is the whole feed with its controls.
   */
  variant: 'card' | 'inbox';
};

const CARD_LIMIT = 2;

function MentionTime({ iso }: { iso: string }) {
  // `title` keeps the exact moment available on hover, since the relative form
  // deliberately loses it.
  return (
    <time className="bnd-time r" dateTime={iso} title={new Date(iso).toLocaleString()}>
      {formatRelativeTime({ iso })}
    </time>
  );
}

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
export function MentionFeed({ variant }: MentionFeedProps) {
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
    const stillUnread = mentionIds ? Math.max(0, unread - mentionIds.length) : 0;
    setUnread(stillUnread);
    announceUnreadMentions(stillUnread);

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

  if (variant === 'card') {
    const fresh = mentions.filter((mention) => !mention.read).slice(0, CARD_LIMIT);
    if (fresh.length === 0) return null;

    return (
      <div className="bnd-card" style={{ marginBottom: 28 }}>
        <div className="bnd-card-h">
          <h3>Mentions</h3>
          <Link href="/inbox" className="bnd-hint">
            View inbox →
          </Link>
        </div>
        {fresh.map((mention) => (
          <div key={mention.id} className="bnd-mention">
            <Avatar id={mention.authorName} name={mention.authorName} />
            <p>
              <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{mention.authorName}</b> mentioned
              you on <Link href={`/documents/${mention.documentId}`}>{mention.documentTitle}</Link>
            </p>
            <MentionTime iso={mention.createdAt} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="bnd-head">
        <div>
          <h1 className="bnd-h1">Inbox</h1>
          <p className="bnd-sub">
            {unread > 0 ? (
              <>
                <span data-testid="unread-count">{unread}</span> unread
              </>
            ) : (
              'All caught up'
            )}
          </p>
        </div>
        {unread > 0 && (
          <button type="button" className="btn ghost sm" onClick={() => markRead()}>
            {BI.check(13)} Mark all read
          </button>
        )}
      </div>

      {mentions.length === 0 ? (
        <div className="bnd-empty">
          <span className="ic">{BI.inbox(22)}</span>
          <h3>No mentions yet</h3>
          <p>
            When someone @mentions you in a comment, it shows up here and — if you&apos;ve turned it
            on — by email or text.
          </p>
          <Link href="/settings" className="bnd-hint">
            Notification settings →
          </Link>
        </div>
      ) : (
        <div className="bnd-card">
          {mentions.map((mention) => (
            <div key={mention.id} className="bnd-note" style={{ cursor: 'default' }}>
              {mention.read ? (
                <span className="bnd-dot" />
              ) : (
                <span className="bnd-dot unread" role="img" aria-label="Unread" />
              )}
              <Avatar id={mention.authorName} name={mention.authorName} />
              <div style={{ minWidth: 0 }}>
                <p>
                  <b>{mention.authorName}</b> mentioned you on{' '}
                  <Link href={`/documents/${mention.documentId}`}>{mention.documentTitle}</Link>
                </p>
                {!mention.read && (
                  <div className="via">
                    <button
                      type="button"
                      className="bnd-link"
                      onClick={() => markRead([mention.id])}
                    >
                      Mark read
                    </button>
                  </div>
                )}
              </div>
              <MentionTime iso={mention.createdAt} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
