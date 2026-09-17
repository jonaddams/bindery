'use client';

import type { DocumentJobKind } from '@prisma/client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentOperation, OperationField } from '@/lib/operations';
import {
  REDACTION_PRESET_LABELS,
  REDACTION_PRESETS,
  type RedactionPreset,
} from '@/lib/operations/redaction';

type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

type Job = {
  id: string;
  kind: DocumentJobKind;
  status: JobStatus;
  parameters: Record<string, unknown>;
  outputDocumentId: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
};

type DocumentToolsProps = {
  documentId: string;
  /**
   * Whether this reader may *start* an operation, as opposed to merely see what
   * has been done. Starting one spends the account's processing credits and
   * creates a document owned by the document's owner, so it takes write access
   * while reading the history does not — the route enforces the same split.
   */
  canRunTools: boolean;
  /** What this deployment offers, decided server-side by `operationsFor`. */
  operations: readonly DocumentOperation[];
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

/** Starting values for an operation's ordinary (select/text) fields. */
const defaultFieldValues = (fields: readonly OperationField[]): Record<string, string> => {
  const values: Record<string, string> = {};

  for (const field of fields) {
    if (field.kind === 'select') {
      values[field.name] = field.defaultValue;
    } else if (field.kind === 'text') {
      values[field.name] = '';
    }
  }

  return values;
};

/**
 * The collapsed Tools menu: pick an operation this deployment supports, fill in
 * its fields, and run it — plus the history of what has already been queued.
 *
 * Collapsed by default so that a document with no operations queued costs no
 * vertical space, and a fifth registered operation costs none either: it is
 * just one more row in a list that only appears once asked for.
 *
 * The job-polling, error handling and busy state below are carried over
 * unchanged from the single-purpose redaction panel this replaces — only the
 * controls are generic now.
 */
export function DocumentTools({ documentId, canRunTools, operations }: DocumentToolsProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState<DocumentJobKind | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
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

      const body: { jobs?: Job[] } = await response.json();
      // Read defensively: a mock, or a future response shape, may not carry a
      // `jobs` array at all, and `jobs.some(...)` below cannot tolerate `undefined`.
      setJobs(Array.isArray(body.jobs) ? body.jobs : []);
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

  const selectedOperation = operations.find((operation) => operation.kind === selectedKind) ?? null;

  const isOpen = menuOpen || selectedOperation !== null;

  const toggleTools = () => {
    if (isOpen) {
      setMenuOpen(false);
      setSelectedKind(null);
      return;
    }

    setMenuOpen(true);
  };

  const chooseOperation = (operation: DocumentOperation) => {
    setSelectedKind(operation.kind);
    setFieldValues(defaultFieldValues(operation.fields));
    setPreset(REDACTION_PRESETS[0]);
    setUseRegex(false);
    setRegex('');
    setCaseSensitive(false);
    setError(null);
    setMenuOpen(false);
  };

  const setFieldValue = (name: string, value: string) => {
    setFieldValues((current) => ({ ...current, [name]: value }));
  };

  /**
   * Every ordinary field (`select`/`text`) maps its value onto `body[name]`
   * directly. `preset-or-regex` is the documented exception: its value is not
   * one field but a strategy — `{ strategy, preset }` or
   * `{ strategy, regex, caseSensitive }` — so it is assembled separately rather
   * than forced into the same shape.
   */
  const buildRequestBody = (operation: DocumentOperation): Record<string, unknown> => {
    const body: Record<string, unknown> = { kind: operation.kind };

    for (const field of operation.fields) {
      if (field.kind === 'select' || field.kind === 'text') {
        body[field.name] = fieldValues[field.name] ?? '';
        continue;
      }

      Object.assign(
        body,
        useRegex ? { strategy: 'regex', regex, caseSensitive } : { strategy: 'preset', preset }
      );
    }

    return body;
  };

  const runOperation = async () => {
    if (!selectedOperation) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/documents/${documentId}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(selectedOperation)),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result?.error ?? 'The job could not be started.');
        return;
      }

      // Show it immediately rather than waiting for the next poll — the work may
      // already be running by the time the response arrives.
      setJobs((current) => [result.job as Job, ...current]);
      setRegex('');
    } catch {
      setError('The job could not be started.');
    } finally {
      setIsBusy(false);
    }
  };

  const needsRegexText =
    selectedOperation?.fields.some((field) => field.kind === 'preset-or-regex') === true &&
    useRegex;

  const canSubmit = !isBusy && (!needsRegexText || regex.trim().length > 0);

  const labelFor = (job: Job): string =>
    operations.find((operation) => operation.kind === job.kind)?.label ?? job.kind;

  return (
    <div className="bg-background shadow rounded-lg border border-border p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-foreground">Tools</h2>

        {canRunTools && (
          <button
            type="button"
            onClick={toggleTools}
            className="rounded bg-primary text-white text-xs px-3 py-1.5 hover:bg-primary-hover transition-colors cursor-pointer"
          >
            Tools
          </button>
        )}
      </div>

      {canRunTools && menuOpen && (
        <ul className="mb-3 divide-y divide-border border border-border rounded">
          {operations.map((operation) => (
            <li key={operation.kind}>
              <button
                type="button"
                onClick={() => chooseOperation(operation)}
                className="w-full text-left px-2 py-1.5 text-xs text-foreground hover:bg-surface transition-colors cursor-pointer"
              >
                <span className="block font-medium">{operation.label}</span>
                <span className="block text-muted">{operation.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canRunTools && selectedOperation && (
        <div className="mb-3">
          <p className="text-xs text-muted mb-2">
            This produces a new document and leaves the original unchanged.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:flex-wrap">
            {selectedOperation.fields.map((field) => {
              if (field.kind === 'select') {
                return (
                  <div key={field.name} className="flex-1 min-w-0">
                    <label
                      htmlFor={`field-${field.name}`}
                      className="block text-xs font-medium text-muted mb-1"
                    >
                      {field.label}
                    </label>
                    <select
                      id={`field-${field.name}`}
                      value={fieldValues[field.name] ?? field.defaultValue}
                      onChange={(event) => setFieldValue(field.name, event.target.value)}
                      className="w-full rounded border border-border bg-background text-foreground text-xs px-2 py-1.5"
                    >
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (field.kind === 'text') {
                return (
                  <div key={field.name} className="flex-1 min-w-0">
                    <label
                      htmlFor={`field-${field.name}`}
                      className="block text-xs font-medium text-muted mb-1"
                    >
                      {field.label}
                    </label>
                    <input
                      id={`field-${field.name}`}
                      type="text"
                      value={fieldValues[field.name] ?? ''}
                      onChange={(event) => setFieldValue(field.name, event.target.value)}
                      placeholder={field.placeholder}
                      maxLength={field.maxLength}
                      className="w-full rounded border border-border bg-background text-foreground text-xs px-2 py-1.5"
                    />
                  </div>
                );
              }

              // 'preset-or-regex' — redaction's existing form, carried over as-is.
              return (
                <div key={field.name} className="flex-1 min-w-0 flex flex-col gap-2">
                  {!useRegex && (
                    <div>
                      <label
                        htmlFor={`field-${field.name}-preset`}
                        className="block text-xs font-medium text-muted mb-1"
                      >
                        {field.label}
                      </label>
                      <select
                        id={`field-${field.name}-preset`}
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
                    <div>
                      <label
                        htmlFor={`field-${field.name}-regex`}
                        className="block text-xs font-medium text-muted mb-1"
                      >
                        Regular expression
                      </label>
                      <input
                        id={`field-${field.name}-regex`}
                        type="text"
                        value={regex}
                        onChange={(event) => setRegex(event.target.value)}
                        placeholder="ACME-[0-9]{4}"
                        className="w-full rounded border border-border bg-background text-foreground text-xs px-2 py-1.5 font-mono"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-4">
                    <label
                      htmlFor={`field-${field.name}-use-regex`}
                      className="flex items-center gap-1.5 text-xs text-muted cursor-pointer"
                    >
                      <input
                        id={`field-${field.name}-use-regex`}
                        type="checkbox"
                        checked={useRegex}
                        onChange={(event) => setUseRegex(event.target.checked)}
                      />
                      Use a pattern of my own
                    </label>

                    {useRegex && (
                      <label
                        htmlFor={`field-${field.name}-case-sensitive`}
                        className="flex items-center gap-1.5 text-xs text-muted cursor-pointer"
                      >
                        <input
                          id={`field-${field.name}-case-sensitive`}
                          type="checkbox"
                          checked={caseSensitive}
                          onChange={(event) => setCaseSensitive(event.target.checked)}
                        />
                        Match case
                      </label>
                    )}
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={runOperation}
              disabled={!canSubmit}
              className="rounded bg-primary text-white text-xs px-3 py-1.5 hover:bg-primary-hover disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isBusy ? 'Starting…' : 'Run'}
            </button>
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {jobs.length === 0 ? (
        <p className="text-xs text-muted">No jobs yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {jobs.map((job) => (
            <li key={job.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_CLASSES[job.status]}`}>
                {STATUS_LABELS[job.status]}
              </span>

              <span className="text-foreground">{labelFor(job)}</span>

              {job.status === 'SUCCEEDED' && job.outputDocumentId && (
                <Link
                  href={`/documents/${job.outputDocumentId}`}
                  className="text-primary hover:text-primary-hover transition-colors"
                >
                  Open result
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
