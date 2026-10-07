import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentTools } from '@/components/document-tools';
import { toOperationSummary } from '@/lib/operations';
import { ocrOperation } from '@/lib/operations/ocr';
import { protectOperation } from '@/lib/operations/protect';
import { redactionOperation } from '@/lib/operations/redaction';

const operations = [redactionOperation, ocrOperation];

type Call = { url: string; method: string; body?: string };

type Job = {
  id: string;
  kind: string;
  status: string;
  description: string;
  outputDocumentId: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
  inputBytes?: number | null;
  outputBytes?: number | null;
};

let calls: Call[] = [];
let jobs: Job[];
let postResponse: { ok: boolean; status: number; body: Record<string, unknown> };

const aJob = (overrides: Partial<Job> = {}): Job => ({
  id: 'job_1',
  kind: 'REDACTION',
  status: 'PENDING',
  description: 'Redact · Social security numbers',
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

const lastPostBody = () =>
  JSON.parse(calls.filter((c) => c.method === 'POST').at(-1)?.body ?? '{}');

describe('The tools menu', () => {
  it('keeps the tools out of the way until asked for', () => {
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    expect(screen.queryByText('Convert to PDF/A')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tools/i })).toBeInTheDocument();
  });

  it('offers only the operations it was given', async () => {
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await userEvent.click(screen.getByRole('button', { name: /tools/i }));

    expect(screen.getByText('OCR')).toBeInTheDocument();
    expect(screen.queryByText('Convert to PDF/A')).not.toBeInTheDocument();
  });

  it('posts the kind of the operation that was chosen', async () => {
    const localFetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ job: { id: 'job_1' } }), { status: 201 }));
    vi.stubGlobal('fetch', localFetchMock);

    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await userEvent.click(screen.getByRole('button', { name: /tools/i }));
    await userEvent.click(screen.getByText('OCR'));
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    const posted = localFetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual(expect.objectContaining({ kind: 'OCR' }));
  });
});

describe('Suggesting OCR for a scan', () => {
  const ocrOnly = [toOperationSummary(ocrOperation)];

  it('offers to make a scanned document searchable', async () => {
    render(<DocumentTools documentId="doc_1" canRunTools operations={ocrOnly} suggestOcr />);

    expect(await screen.findByText(/looks like a scan/i)).toBeVisible();
  });

  it('runs OCR in the chosen language when asked', async () => {
    render(<DocumentTools documentId="doc_1" canRunTools operations={ocrOnly} suggestOcr />);

    await userEvent.selectOptions(await screen.findByLabelText('Scan language'), 'german');
    await userEvent.click(screen.getByRole('button', { name: 'Make searchable' }));

    expect(lastPostBody()).toEqual({ kind: 'OCR', language: 'german' });
  });

  it('says why, when OCR could not be started', async () => {
    postResponse = { ok: false, status: 400, body: { error: 'Out of processing credits.' } };
    render(<DocumentTools documentId="doc_1" canRunTools operations={ocrOnly} suggestOcr />);

    await userEvent.click(await screen.findByRole('button', { name: 'Make searchable' }));

    expect(await screen.findByText('Out of processing credits.')).toBeVisible();
  });

  it('stops suggesting once OCR has been run or queued', async () => {
    jobs = [aJob({ kind: 'OCR', status: 'PENDING', description: 'OCR · English' })];
    render(<DocumentTools documentId="doc_1" canRunTools operations={ocrOnly} suggestOcr />);

    await screen.findByText('OCR · English');
    expect(screen.queryByText(/looks like a scan/i)).not.toBeInTheDocument();
  });

  it('suggests nothing for a document that has text', async () => {
    render(<DocumentTools documentId="doc_1" canRunTools operations={ocrOnly} />);

    await screen.findByText(/no jobs/i);
    expect(screen.queryByText(/looks like a scan/i)).not.toBeInTheDocument();
  });

  // Running OCR spends the owner's credits, so a reader is not offered it.
  it('suggests nothing to someone who may only read the document', async () => {
    render(
      <DocumentTools documentId="doc_1" canRunTools={false} operations={ocrOnly} suggestOcr />
    );

    await screen.findByText(/no jobs/i);
    expect(screen.queryByText(/looks like a scan/i)).not.toBeInTheDocument();
  });
});

describe('Hearing that a job finished', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces a job that finishes while the page is open, with a way to open the result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    jobs = [aJob({ status: 'RUNNING', description: 'Compress · Maximum' })];
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);
    await screen.findByText(/in progress/i);

    jobs = [
      aJob({ status: 'SUCCEEDED', description: 'Compress · Maximum', outputDocumentId: 'doc_9' }),
    ];
    await vi.advanceTimersByTimeAsync(3100);

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Compress · Maximum is ready');
    expect(within(toast).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/documents/doc_9'
    );
  });

  it('says so when a job fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    jobs = [aJob({ status: 'RUNNING', description: 'OCR · German' })];
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);
    await screen.findByText(/in progress/i);

    jobs = [aJob({ status: 'FAILED', description: 'OCR · German', error: 'out of credits' })];
    await vi.advanceTimersByTimeAsync(3100);

    expect(await screen.findByRole('status')).toHaveTextContent('OCR · German failed');
  });

  // History is not news: only a change seen on this page is announced.
  it('does not announce jobs that had already finished when the page opened', async () => {
    jobs = [aJob({ status: 'SUCCEEDED', outputDocumentId: 'doc_9' })];
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await screen.findByRole('link', { name: /open/i });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('A document tools cannot open', () => {
  it('explains why instead of offering tools that would fail', async () => {
    render(
      <DocumentTools
        documentId="doc_1"
        canRunTools
        operations={operations}
        unavailableReason="This is a password-protected copy, so tools cannot open it."
      />
    );

    expect(await screen.findByText(/password-protected copy/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^tools/i })).not.toBeInTheDocument();
  });
});

describe('Moving between tools', () => {
  // With ten tools, being stuck on one form until the menu is closed and
  // reopened was found by using the page, not by a test.
  it('goes back from a chosen tool to the whole list', async () => {
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await userEvent.click(screen.getByRole('button', { name: /tools/i }));
    await userEvent.click(screen.getByText('OCR'));
    expect(screen.queryByText('Redact')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'All tools' }));

    expect(screen.getByText('Redact')).toBeVisible();
    expect(screen.getByText('OCR')).toBeVisible();
  });
});

describe('Password-protecting through the tools menu', () => {
  it('takes the password in a password box, so it is never shown on screen', async () => {
    render(
      <DocumentTools
        documentId="doc_1"
        canRunTools
        operations={[toOperationSummary(protectOperation)]}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /tools/i }));
    await userEvent.click(screen.getByText('Password-protect'));

    expect(screen.getByLabelText('Password to open')).toHaveAttribute('type', 'password');
  });
});

describe('Starting a redaction through the tools menu', () => {
  it('offers the patterns by name rather than by API identifier', async () => {
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await userEvent.click(screen.getByRole('button', { name: /tools/i }));
    await userEvent.click(screen.getByText('Redact'));

    const select = await screen.findByLabelText(/what to redact/i);
    expect(select).toHaveTextContent('Social security numbers');
    expect(select).not.toHaveTextContent('social-security-number');
  });

  it('queues the chosen pattern', async () => {
    const user = userEvent.setup();
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await user.click(screen.getByRole('button', { name: /tools/i }));
    await user.click(screen.getByText('Redact'));
    await user.selectOptions(await screen.findByLabelText(/what to redact/i), 'email-address');
    await user.click(screen.getByRole('button', { name: /run/i }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(lastPostBody()).toEqual({
      kind: 'REDACTION',
      strategy: 'preset',
      preset: 'email-address',
    });
  });

  it('can redact a regular expression instead', async () => {
    const user = userEvent.setup();
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await user.click(screen.getByRole('button', { name: /tools/i }));
    await user.click(screen.getByText('Redact'));

    // No square brackets or braces in the typed text: user-event reads those as
    // key descriptors rather than literal characters.
    await user.click(await screen.findByLabelText(/pattern of my own/i));
    await user.type(screen.getByLabelText(/regular expression/i), 'ACME-\\d+');
    await user.click(screen.getByRole('button', { name: /run/i }));

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
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await user.click(screen.getByRole('button', { name: /tools/i }));
    await user.click(screen.getByText('Redact'));

    await user.click(await screen.findByLabelText(/pattern of my own/i));
    await user.click(screen.getByRole('button', { name: /run/i }));

    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  // The output is a separate document. Someone who expects their file to be
  // edited in place will otherwise look for a change that never comes.
  it('says the original is left alone and a copy is made', async () => {
    const user = userEvent.setup();
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await user.click(screen.getByRole('button', { name: /tools/i }));
    await user.click(screen.getByText('Redact'));

    expect(
      await screen.findByText(/new document|copy|original is (left )?unchanged/i)
    ).toBeVisible();
  });

  it('reports the reason the server refused', async () => {
    const user = userEvent.setup();
    postResponse = { ok: false, status: 400, body: { error: 'That is not a valid pattern.' } };
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await user.click(screen.getByRole('button', { name: /tools/i }));
    await user.click(screen.getByText('Redact'));
    await user.click(await screen.findByLabelText(/pattern of my own/i));
    await user.type(screen.getByLabelText(/regular expression/i), '(unclosed');
    await user.click(screen.getByRole('button', { name: /run/i }));

    expect(await screen.findByText(/not a valid pattern/i)).toBeVisible();
  });
});

describe('Watching a job run', () => {
  it('shows work that is still going', async () => {
    jobs = [aJob({ status: 'RUNNING' })];
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    expect(await screen.findByText(/in progress|running/i)).toBeVisible();
  });

  it('links to the result once it exists', async () => {
    jobs = [
      aJob({
        status: 'SUCCEEDED',
        outputDocumentId: 'doc_2',
        finishedAt: new Date().toISOString(),
      }),
    ];
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    const link = await screen.findByRole('link', { name: /open/i });
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
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    expect(await screen.findByText(/out of credits/i)).toBeVisible();
  });

  // Job history used to say "Redact" for every redaction. The server describes
  // each job from what it stored, so history says what was actually done.
  it('names what each job did, as the server describes it', async () => {
    jobs = [
      aJob({ kind: 'OCR', status: 'SUCCEEDED', description: 'OCR · German' }),
      aJob({ id: 'job_2', status: 'SUCCEEDED', description: 'Redact · Email addresses' }),
    ];
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    expect(await screen.findByText('OCR · German')).toBeVisible();
    expect(screen.getByText('Redact · Email addresses')).toBeVisible();
  });

  it('shows what a finished job did to the size of the file', async () => {
    jobs = [
      aJob({
        status: 'SUCCEEDED',
        description: 'Compress · Maximum',
        outputDocumentId: 'doc_2',
        inputBytes: 1_800_000,
        outputBytes: 220_000,
      }),
    ];
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    expect(await screen.findByText('1.72 MB → 214.84 KB (−88%)')).toBeVisible();
  });

  // Growth is reported without a percentage: "+1,200%" for OCR adding a text
  // layer would read as a warning.
  it('shows a larger result without a percentage', async () => {
    jobs = [
      aJob({
        status: 'SUCCEEDED',
        outputDocumentId: 'doc_2',
        inputBytes: 100_000,
        outputBytes: 150_000,
      }),
    ];
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    expect(await screen.findByText('97.66 KB → 146.48 KB')).toBeVisible();
  });

  it('says so when nothing has been done yet', async () => {
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    expect(await screen.findByText(/no jobs|nothing/i)).toBeVisible();
  });
});

describe('Someone who may only read the document', () => {
  it('is not offered the tools menu, since queueing spends the owner’s credits', async () => {
    jobs = [aJob({ status: 'SUCCEEDED', outputDocumentId: 'doc_2' })];
    render(<DocumentTools documentId="doc_1" canRunTools={false} operations={operations} />);

    await screen.findByText('Redact · Social security numbers');
    expect(screen.queryByRole('button', { name: /tools/i })).not.toBeInTheDocument();
  });

  it('can still see what has been done to the document', async () => {
    jobs = [aJob({ status: 'SUCCEEDED', outputDocumentId: 'doc_2' })];
    render(<DocumentTools documentId="doc_1" canRunTools={false} operations={operations} />);

    expect(await screen.findByRole('link', { name: /open/i })).toBeVisible();
  });
});
