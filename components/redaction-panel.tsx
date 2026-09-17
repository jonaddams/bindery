'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  REDACTION_PRESET_LABELS,
  REDACTION_PRESETS,
  type RedactionPreset,
} from '@/lib/operations/redaction';

type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

type Job = {
  id: string;
  kind: string;
  status: JobStatus;
  parameters: Record<string, unknown>;
  outputDocumentId: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
};

type RedactionPanelProps = {
  documentId: string;
  /**
   * Whether this reader may *start* a redaction, as opposed to merely see what
   * has been done. Starting one spends the account's processing credits and
   * creates a document owned by the document's owner, so it takes write access
   * while reading the history does not — the route enforces the same split.
   */
  canRedact: boolean;
};

/** How often to ask whether a running job has finished. */
const POLL_INTERVAL_MS = 3000;

const isFinished = (job: Job): boolean => job.status === 'SUCCEEDED' || job.status === 'FAILED';

const STATUS_LABELS: Record<JobStatus, string> = {
  PENDING: 'Queued',
  RUNNING: 'In progress',
  SUCCEEDED: 'Done',
  FAILED: 'Failed',
};

const STATUS_CLASSES: Record<JobStatus, string> = {
  PENDING: 'bg-surface text-muted',
  RUNNING: 'bg-surface text-primary',
  SUCCEEDED: 'bg-surface text-foreground',
  FAILED: 'bg-surface text-red-600 dark:text-red-400',
};

/**
 * Say what a job was asked to remove, from the parameters it stored.
 *
 * Read defensively: `parameters` is a Json column, so a row written by older
 * code is not guaranteed to match what this component expects.
 */
const describeRedaction = (parameters: Record<string, unknown>): string => {
  if (parameters.strategy === 'preset') {
    const preset = parameters.preset as RedactionPreset;
    return REDACTION_PRESET_LABELS[preset] ?? String(preset);
  }

  if (parameters.strategy === 'regex') {
    return `Pattern: ${String(parameters.regex)}`;
  }

  return 'Unknown redaction';
};

/**
 * Start a redaction, and watch the ones already asked for.
 *
 * The work happens elsewhere — the request only queues it — so the panel polls
 * while anything is unfinished. There is no push channel to replace this with:
 * the job runs in `after()` on the server or in a scheduled sweep, and neither
 * can reach the browser.
 *
 * Polling stops as soon as nothing is outstanding, so an idle document costs
 * nothing.
 */
export function RedactionPanel({ documentId, canRedact }: RedactionPanelProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [preset, setPreset] = useState<RedactionPreset>(REDACTION_PRESETS[0]);
  const [useRegex, setUseRegex] = useState(false);
  const [regex, setRegex] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const hasUnfinished = jobs.some((job) => !isFinished(job));

  // Held in a ref so the polling effect does not restart on every render.
  const unfinishedRef = useRef(hasUnfinished);
  unfinishedRef.current = hasUnfinished;

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}/jobs`);

      if (!response.ok) {
        return;
      }

      const body: { jobs: Job[] } = await response.json();
      setJobs(body.jobs);
    } catch {
      // A failed poll is not worth reporting: the next one is three seconds
      // away, and a transient blip would otherwise show as a hard error.
    }
  }, [documentId]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!hasUnfinished) {
      return;
    }

    const interval = setInterval(() => {
      if (unfinishedRef.current) {
        void loadJobs();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [hasUnfinished, loadJobs]);

  const startRedaction = async () => {
    const body = useRegex
      ? { kind: 'REDACTION', strategy: 'regex', regex, caseSensitive }
      : { kind: 'REDACTION', strategy: 'preset', preset };

    setIsBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/documents/${documentId}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result?.error ?? 'The redaction could not be started.');
        return;
      }

      // Show it immediately rather than waiting for the next poll — the work may
      // already be running by the time the response arrives.
      setJobs((current) => [result.job as Job, ...current]);
      setRegex('');
    } catch {
      setError('The redaction could not be started.');
    } finally {
      setIsBusy(false);
    }
  };

  const canSubmit = !isBusy && (!useRegex || regex.trim().length > 0);

  return (
    <div className="bg-background shadow rounded-lg border border-border p-3 mb-3">
      <h2 className="text-sm font-medium text-foreground mb-2">Redaction</h2>

      {canRedact && (
        <div className="mb-3">
          <p className="text-xs text-muted mb-2">
            Redacting produces a new document and leaves the original unchanged.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:flex-wrap">
            {!useRegex && (
              <div className="flex-1 min-w-0">
                <label
                  htmlFor="redaction-preset"
                  className="block text-xs font-medium text-muted mb-1"
                >
                  What to redact
                </label>
                <select
                  id="redaction-preset"
                  value={preset}
                  onChange={(event) => setPreset(event.target.value as RedactionPreset)}
                  className="w-full rounded border border-border bg-background text-foreground text-xs px-2 py-1.5"
                >
                  {REDACTION_PRESETS.map((option) => (
                    <option key={option} value={option}>
                      {REDACTION_PRESET_LABELS[option]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {useRegex && (
              <div className="flex-1 min-w-0">
                <label
                  htmlFor="redaction-regex"
                  className="block text-xs font-medium text-muted mb-1"
                >
                  Regular expression
                </label>
                <input
                  id="redaction-regex"
                  type="text"
                  value={regex}
                  onChange={(event) => setRegex(event.target.value)}
                  placeholder="ACME-[0-9]{4}"
                  className="w-full rounded border border-border bg-background text-foreground text-xs px-2 py-1.5 font-mono"
                />
              </div>
            )}

            <button
              type="button"
              onClick={startRedaction}
              disabled={!canSubmit}
              className="rounded bg-primary text-white text-xs px-3 py-1.5 hover:bg-primary-hover disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isBusy ? 'Starting…' : 'Redact'}
            </button>
          </div>

          <div className="flex flex-wrap gap-4 mt-2">
            <label
              htmlFor="redaction-use-regex"
              className="flex items-center gap-1.5 text-xs text-muted cursor-pointer"
            >
              <input
                id="redaction-use-regex"
                type="checkbox"
                checked={useRegex}
                onChange={(event) => setUseRegex(event.target.checked)}
              />
              Use a pattern of my own
            </label>

            {useRegex && (
              <label
                htmlFor="redaction-case-sensitive"
                className="flex items-center gap-1.5 text-xs text-muted cursor-pointer"
              >
                <input
                  id="redaction-case-sensitive"
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(event) => setCaseSensitive(event.target.checked)}
                />
                Match case
              </label>
            )}
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {jobs.length === 0 ? (
        <p className="text-xs text-muted">No redactions yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {jobs.map((job) => (
            <li key={job.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_CLASSES[job.status]}`}>
                {STATUS_LABELS[job.status]}
              </span>

              <span className="text-foreground">{describeRedaction(job.parameters)}</span>

              {job.status === 'SUCCEEDED' && job.outputDocumentId && (
                <Link
                  href={`/documents/${job.outputDocumentId}`}
                  className="text-primary hover:text-primary-hover transition-colors"
                >
                  Open redacted copy
                </Link>
              )}

              {job.status === 'FAILED' && job.error && (
                <span className="text-red-600 dark:text-red-400 break-all">{job.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
