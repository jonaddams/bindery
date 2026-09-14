import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { RedactionPanel } = await import('@/components/redaction-panel');

type Call = { url: string; method: string; body?: string };

type Job = {
  id: string;
  kind: string;
  status: string;
  parameters: Record<string, unknown>;
  outputDocumentId: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
};

let calls: Call[] = [];
let jobs: Job[];
let postResponse: { ok: boolean; status: number; body: Record<string, unknown> };

const aJob = (overrides: Partial<Job> = {}): Job => ({
  id: 'job_1',
  kind: 'REDACTION',
  status: 'PENDING',
  parameters: { strategy: 'preset', preset: 'social-security-number' },
  outputDocumentId: null,
  error: null,
  attempts: 0,
  createdAt: new Date('2026-09-14T12:00:00Z').toISOString(),
  finishedAt: null,
  ...overrides,
});

const fetchMock = vi.fn((input: unknown, init?: { method?: string; body?: string }) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body });

  if (method === 'POST') {
    return Promise.resolve({
      ok: postResponse.ok,
      status: postResponse.status,
      json: () => Promise.resolve(postResponse.body),
    });
  }

  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ jobs }) });
});

beforeEach(() => {
  calls = [];
  jobs = [];
  postResponse = { ok: true, status: 202, body: { job: aJob() } };
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPanel = (canRedact = true) =>
  render(<RedactionPanel documentId="doc_1" canRedact={canRedact} />);

const lastPostBody = () =>
  JSON.parse(calls.filter((c) => c.method === 'POST').at(-1)?.body ?? '{}');

describe('Starting a redaction', () => {
  it('offers the patterns by name rather than by API identifier', async () => {
    renderPanel();

    const select = await screen.findByLabelText(/what to redact/i);

    expect(select).toHaveTextContent('Social security numbers');
    expect(select).not.toHaveTextContent('social-security-number');
  });

  it('queues the chosen pattern', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(await screen.findByLabelText(/what to redact/i), 'email-address');
    await user.click(screen.getByRole('button', { name: /redact/i }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(lastPostBody()).toEqual({
      kind: 'REDACTION',
      strategy: 'preset',
      preset: 'email-address',
    });
  });

  it('can redact a regular expression instead', async () => {
    const user = userEvent.setup();
    renderPanel();

    // No square brackets or braces in the typed text: user-event reads those as
    // key descriptors rather than literal characters.
    await user.click(await screen.findByLabelText(/pattern of my own/i));
    await user.type(screen.getByLabelText(/regular expression/i), 'ACME-\\d+');
    await user.click(screen.getByRole('button', { name: /redact/i }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(lastPostBody()).toEqual({
      kind: 'REDACTION',
      strategy: 'regex',
      regex: 'ACME-\\d+',
      caseSensitive: false,
    });
  });

  it('will not submit an empty regular expression', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByLabelText(/pattern of my own/i));
    await user.click(screen.getByRole('button', { name: /redact/i }));

    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  // The output is a separate document. Someone who expects their file to be
  // edited in place will otherwise look for a change that never comes.
  it('says the original is left alone and a copy is made', async () => {
    renderPanel();

    expect(
      await screen.findByText(/new document|copy|original is (left )?unchanged/i)
    ).toBeVisible();
  });

  it('reports the reason the server refused', async () => {
    const user = userEvent.setup();
    postResponse = { ok: false, status: 400, body: { error: 'That is not a valid pattern.' } };
    renderPanel();

    await user.click(await screen.findByLabelText(/pattern of my own/i));
    await user.type(screen.getByLabelText(/regular expression/i), '(unclosed');
    await user.click(screen.getByRole('button', { name: /redact/i }));

    expect(await screen.findByText(/not a valid pattern/i)).toBeVisible();
  });
});

describe('Watching a redaction run', () => {
  it('shows work that is still going', async () => {
    jobs = [aJob({ status: 'RUNNING' })];
    renderPanel();

    expect(await screen.findByText(/in progress|running/i)).toBeVisible();
  });

  it('links to the redacted copy once it exists', async () => {
    jobs = [
      aJob({
        status: 'SUCCEEDED',
        outputDocumentId: 'doc_2',
        finishedAt: new Date().toISOString(),
      }),
    ];
    renderPanel();

    const link = await screen.findByRole('link', { name: /redacted|open/i });
    expect(link).toHaveAttribute('href', '/documents/doc_2');
  });

  it('shows why a job failed, in the words the server recorded', async () => {
    jobs = [
      aJob({
        status: 'FAILED',
        error: 'Processing failed: 402 - out of credits',
        finishedAt: new Date().toISOString(),
      }),
    ];
    renderPanel();

    expect(await screen.findByText(/out of credits/i)).toBeVisible();
  });

  it('describes what each job was asked to remove', async () => {
    jobs = [aJob({ status: 'SUCCEEDED', outputDocumentId: 'doc_2' })];
    renderPanel();

    expect(await screen.findByText(/social security numbers/i)).toBeVisible();
  });

  it('says so when nothing has been redacted yet', async () => {
    renderPanel();

    expect(await screen.findByText(/no redactions|nothing/i)).toBeVisible();
  });
});

describe('Someone who may only read the document', () => {
  it('is not offered the control, since queueing spends the owner’s credits', async () => {
    jobs = [aJob({ status: 'SUCCEEDED', outputDocumentId: 'doc_2' })];
    renderPanel(false);

    await screen.findByText(/social security numbers/i);
    expect(screen.queryByRole('button', { name: /redact/i })).not.toBeInTheDocument();
  });

  it('can still see what has been done to the document', async () => {
    jobs = [aJob({ status: 'SUCCEEDED', outputDocumentId: 'doc_2' })];
    renderPanel(false);

    expect(await screen.findByRole('link', { name: /redacted|open/i })).toBeVisible();
  });
});
