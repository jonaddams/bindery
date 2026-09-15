import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { MentionFeed } = await import('@/components/mention-feed');

type Call = { url: string; method: string; body?: string };

let calls: Call[] = [];
let feed: { mentions: unknown[]; unread: number };

const aMention = (overrides: Record<string, unknown> = {}) => ({
  id: 'mention_1',
  authorName: 'Bryan Rust',
  documentId: 'doc_1',
  documentTitle: 'Q3 Contract',
  createdAt: new Date('2026-09-15T15:15:15Z').toISOString(),
  read: false,
  ...overrides,
});

const fetchMock = vi.fn((input: unknown, init?: { method?: string; body?: string }) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body });

  if (method === 'POST') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ read: 1 }) });
  }

  return Promise.resolve({ ok: true, json: () => Promise.resolve(feed) });
});

beforeEach(() => {
  calls = [];
  feed = { mentions: [aMention()], unread: 1 };
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Showing mentions', () => {
  it('says who mentioned you and on what', async () => {
    render(<MentionFeed />);

    expect(await screen.findByText(/Bryan Rust/)).toBeVisible();
    expect(screen.getByRole('link', { name: /Q3 Contract/ })).toHaveAttribute(
      'href',
      '/documents/doc_1'
    );
  });

  // The feed names the document and links to it; the comment body lives in DWS
  // and would cost a fetch per thread to show. See lib/mention-feed.ts.
  it('shows an unread count', async () => {
    feed = { mentions: [aMention(), aMention({ id: 'mention_2' })], unread: 2 };

    render(<MentionFeed />);

    expect(await screen.findByText('2')).toBeVisible();
  });

  // A bare date renders every mention from today identically, which is the one
  // thing a feed of recent activity most needs to distinguish.
  it('says how long ago rather than printing a date', async () => {
    feed = {
      mentions: [aMention({ createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() })],
      unread: 1,
    };

    render(<MentionFeed />);

    expect(await screen.findByText('4 hours ago')).toBeVisible();
  });

  it('keeps the exact moment available on hover', async () => {
    const createdAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    feed = { mentions: [aMention({ createdAt })], unread: 1 };

    render(<MentionFeed />);

    expect(await screen.findByText('4 hours ago')).toHaveAttribute(
      'title',
      new Date(createdAt).toLocaleString()
    );
  });

  it('says so when there is nothing', async () => {
    feed = { mentions: [], unread: 0 };

    render(<MentionFeed />);

    expect(await screen.findByText(/no mentions|nothing/i)).toBeVisible();
  });

  it('does not show a count when everything is read', async () => {
    feed = { mentions: [aMention({ read: true })], unread: 0 };

    render(<MentionFeed />);

    await screen.findByText(/Bryan Rust/);
    expect(screen.queryByTestId('unread-count')).not.toBeInTheDocument();
  });
});

describe('Marking read', () => {
  it('marks one mention read', async () => {
    const user = userEvent.setup();
    render(<MentionFeed />);

    await user.click(await screen.findByRole('button', { name: /mark read/i }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.filter((c) => c.method === 'POST')[0].body ?? '{}')).toEqual({
      mentionIds: ['mention_1'],
    });
  });

  it('marks everything read', async () => {
    const user = userEvent.setup();
    render(<MentionFeed />);

    await user.click(await screen.findByRole('button', { name: /mark all read/i }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.filter((c) => c.method === 'POST')[0].body ?? '{}')).toEqual({});
  });

  // Reading is explicit: opening the document must not mark anything, or the
  // count becomes something nobody can trust.
  it('does not mark anything read merely by following the link', async () => {
    const user = userEvent.setup();
    render(<MentionFeed />);

    await user.click(await screen.findByRole('link', { name: /Q3 Contract/ }));

    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('offers no mark-read control for something already read', async () => {
    feed = { mentions: [aMention({ read: true })], unread: 0 };

    render(<MentionFeed />);

    await screen.findByText(/Bryan Rust/);
    expect(screen.queryByRole('button', { name: /^mark read$/i })).not.toBeInTheDocument();
  });

  it('hides the mark-all control when nothing is unread', async () => {
    feed = { mentions: [aMention({ read: true })], unread: 0 };

    render(<MentionFeed />);

    await screen.findByText(/Bryan Rust/);
    expect(screen.queryByRole('button', { name: /mark all read/i })).not.toBeInTheDocument();
  });
});
