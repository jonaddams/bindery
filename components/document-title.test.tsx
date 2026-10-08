import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { DocumentTitle } = await import('@/components/document-title');

let response: { ok: boolean; status: number; body: Record<string, unknown> };
const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => ({
  ok: response.ok,
  status: response.status,
  json: async () => response.body,
  sent: init?.body,
}));

beforeEach(() => {
  vi.clearAllMocks();
  response = { ok: true, status: 200, body: { document: { title: 'Q3 Contract (signed)' } } };
  vi.stubGlobal('fetch', fetchMock);
});

const startRenaming = async () => {
  render(<DocumentTitle documentId="doc_1" title="Q3 Contract" canRename />);
  await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
  return screen.getByRole('textbox', { name: 'Document title' });
};

describe('A document’s title', () => {
  it('is shown as the page heading', () => {
    render(<DocumentTitle documentId="doc_1" title="Q3 Contract" canRename={false} />);

    expect(screen.getByRole('heading', { name: 'Q3 Contract' })).toBeVisible();
  });

  // Renaming takes write access, as the route does.
  it('can only be renamed by someone who may edit the document', () => {
    render(<DocumentTitle documentId="doc_1" title="Q3 Contract" canRename={false} />);

    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('is renamed in place and shows the new title', async () => {
    const input = await startRenaming();

    await userEvent.clear(input);
    await userEvent.type(input, 'Q3 Contract (signed){Enter}');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/documents/doc_1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ title: 'Q3 Contract (signed)' }),
      })
    );
    expect(await screen.findByRole('heading', { name: 'Q3 Contract (signed)' })).toBeVisible();
    expect(refresh).toHaveBeenCalled();
  });

  it('is left as it was when renaming is cancelled', async () => {
    const input = await startRenaming();

    await userEvent.type(input, ' draft{Escape}');

    expect(screen.getByRole('heading', { name: 'Q3 Contract' })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cannot be saved blank', async () => {
    const input = await startRenaming();

    await userEvent.clear(input);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('says why the server refused the new title, and keeps it for editing', async () => {
    response = {
      ok: false,
      status: 400,
      body: { error: 'A title can be at most 200 characters.' },
    };
    const input = await startRenaming();

    await userEvent.type(input, ' and more{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('at most 200 characters');
    expect(screen.getByRole('textbox', { name: 'Document title' })).toHaveValue(
      'Q3 Contract and more'
    );
  });
});
