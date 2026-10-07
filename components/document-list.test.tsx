import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SessionUser = { id: string; role: string; currentImpersonationMode: string };

let sessionUser: SessionUser = { id: 'me', role: 'USER', currentImpersonationMode: 'SELF' };

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: sessionUser }, isPending: false }),
}));

const { DocumentList } = await import('@/components/document-list');

type Call = { url: string; method: string };

let calls: Call[] = [];

const aDocument = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc_1',
  title: 'Q3 Contract',
  filename: 'q3-contract.pdf',
  fileType: 'application/pdf',
  fileSize: '2048',
  ownerId: 'me',
  owner: { name: 'Me Myself', email: 'me@nutrient.io' },
  createdAt: new Date('2026-09-15T15:15:15Z').toISOString(),
  ...overrides,
});

let documents: unknown[] = [];

const fetchMock = vi.fn((input: unknown, init?: { method?: string }) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  calls.push({ url, method });

  if (method === 'DELETE') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }

  return Promise.resolve({ ok: true, json: () => Promise.resolve({ documents }) });
});

beforeEach(() => {
  calls = [];
  sessionUser = { id: 'me', role: 'USER', currentImpersonationMode: 'SELF' };
  documents = [
    aDocument(),
    aDocument({
      id: 'doc_2',
      title: 'Board Minutes',
      filename: 'minutes.docx',
      ownerId: 'someone',
      owner: { name: 'Kris Letang', email: 'kris@nutrient.io' },
    }),
  ];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Grouping processed copies with their original', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 7, 12, minutes)).toISOString();

  beforeEach(() => {
    documents = [
      aDocument({ id: 'doc_1', title: 'Q3 Contract', createdAt: at(0) }),
      aDocument({
        id: 'doc_2',
        title: 'Board Minutes',
        filename: 'minutes.pdf',
        createdAt: at(10),
      }),
      aDocument({
        id: 'doc_3',
        title: 'Q3 Contract (compressed)',
        filename: 'q3-contract-compressed.pdf',
        derivedFromId: 'doc_1',
        createdAt: at(20),
      }),
      aDocument({
        id: 'doc_4',
        title: 'Q3 Contract (compressed) (protected)',
        filename: 'q3-contract-compressed-protected.pdf',
        derivedFromId: 'doc_3',
        createdAt: at(30),
      }),
    ];
  });

  const titlesInOrder = () =>
    screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/documents/'))
      .map((link) => link.textContent);

  it('folds copies under their original until asked to show them', async () => {
    render(<DocumentList />);

    await screen.findByText('Q3 Contract');
    expect(screen.queryByText('Q3 Contract (compressed)')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /3 versions/i }));

    expect(screen.getByText('Q3 Contract (compressed)')).toBeVisible();
    expect(screen.getByText('Q3 Contract (compressed) (protected)')).toBeVisible();
  });

  // A copy of a copy belongs with the first document, not with its parent alone.
  it('follows a chain of copies back to the first document', async () => {
    render(<DocumentList />);

    expect(await screen.findByRole('button', { name: /3 versions/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('puts the document with the newest work first', async () => {
    render(<DocumentList />);
    await screen.findByText('Q3 Contract');

    expect(titlesInOrder()).toEqual(['Q3 Contract', 'Board Minutes']);
  });

  it('shows a copy on its own when its original is not in the list', async () => {
    render(<DocumentList />);
    await screen.findByText('Q3 Contract');

    await userEvent.type(screen.getByPlaceholderText(/search/i), 'protected');

    expect(screen.getByText('Q3 Contract (compressed) (protected)')).toBeVisible();
  });
});

const openActions = async (title: string) => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Actions for ${title}` }));
  return user;
};

describe('Listing documents', () => {
  it('links each document to its viewer', async () => {
    render(<DocumentList />);

    expect(await screen.findByRole('link', { name: 'Q3 Contract' })).toHaveAttribute(
      'href',
      '/documents/doc_1'
    );
  });

  it('says how many there are and how many were shared', async () => {
    render(<DocumentList />);

    expect(await screen.findByText('2 documents · 1 shared with you')).toBeVisible();
  });

  it('invites an upload when there are none', async () => {
    documents = [];
    render(<DocumentList />);

    expect(await screen.findByText(/no documents yet/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /upload a document/i })).toHaveAttribute(
      'href',
      '/upload'
    );
  });
});

describe('Finding a document', () => {
  it('narrows the list by search', async () => {
    const user = userEvent.setup();
    render(<DocumentList />);

    await user.type(await screen.findByRole('textbox', { name: 'Search documents' }), 'board');

    expect(screen.getByRole('link', { name: 'Board Minutes' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Q3 Contract' })).not.toBeInTheDocument();
  });

  it('matches the filename as well as the title', async () => {
    const user = userEvent.setup();
    render(<DocumentList />);

    await user.type(await screen.findByRole('textbox', { name: 'Search documents' }), 'q3-con');

    expect(screen.getByRole('link', { name: 'Q3 Contract' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Board Minutes' })).not.toBeInTheDocument();
  });

  it('shows only my documents under Mine', async () => {
    const user = userEvent.setup();
    render(<DocumentList />);

    await user.click(await screen.findByRole('button', { name: /^mine/i }));

    expect(screen.getByRole('link', { name: 'Q3 Contract' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Board Minutes' })).not.toBeInTheDocument();
  });

  it("shows only others' documents under Shared with me", async () => {
    const user = userEvent.setup();
    render(<DocumentList />);

    await user.click(await screen.findByRole('button', { name: /^shared with me/i }));

    expect(screen.getByRole('link', { name: 'Board Minutes' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Q3 Contract' })).not.toBeInTheDocument();
  });

  it('says so when nothing matches, and can clear the filters', async () => {
    const user = userEvent.setup();
    render(<DocumentList />);

    await user.type(await screen.findByRole('textbox', { name: 'Search documents' }), 'zzz');
    expect(screen.getByText(/no matches/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByRole('link', { name: 'Q3 Contract' })).toBeVisible();
  });
});

describe('Deleting a document', () => {
  it('asks before deleting, and cancelling deletes nothing', async () => {
    render(<DocumentList />);
    const user = await openActions('Q3 Contract');

    await user.click(screen.getByRole('menuitem', { name: /delete/i }));
    const dialog = screen.getByRole('dialog', { name: /delete this document/i });
    expect(within(dialog).getByText('Q3 Contract')).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByRole('link', { name: 'Q3 Contract' })).toBeVisible();
  });

  it('deletes on confirmation and removes the row', async () => {
    render(<DocumentList />);
    const user = await openActions('Q3 Contract');

    await user.click(screen.getByRole('menuitem', { name: /delete/i }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Q3 Contract' })).not.toBeInTheDocument()
    );
    expect(calls).toContainEqual({ url: '/api/documents/doc_1', method: 'DELETE' });
  });

  it("offers no delete on someone else's document", async () => {
    render(<DocumentList />);
    await openActions('Board Minutes');

    expect(screen.getByRole('menuitem', { name: /open/i })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument();
  });

  it("offers delete on anyone's document to an admin acting as admin", async () => {
    sessionUser = { id: 'me', role: 'ADMIN', currentImpersonationMode: 'ADMIN' };
    render(<DocumentList />);
    await openActions('Board Minutes');

    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeVisible();
  });
});

describe('Sharing a link', () => {
  it('copies a link to the document', async () => {
    render(<DocumentList />);
    const user = await openActions('Q3 Contract');
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();

    await user.click(screen.getByRole('menuitem', { name: /copy link/i }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/documents/doc_1`);
  });
});
