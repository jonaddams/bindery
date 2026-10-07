'use client';

import type { DocumentJobKind } from '@prisma/client';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { BI } from '@/components/bindery/icons';
import { RailSection } from '@/components/rail-section';
import type { OperationField, OperationSummary } from '@/lib/operations';
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
  /** What the job did, worded by the server from its stored parameters. */
  description: string;
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
  operations: readonly OperationSummary[];
  /**
   * The document looked like a scan when it was stored (`Document.likelyScanned`),
   * so offer to make it searchable until OCR has been run or queued.
   */
  suggestOcr?: boolean;
};

type Toast = { id: string; text: string; tone: 'ok' | 'bad'; href?: string };

/** Long enough to read and reach for the link; short enough not to pile up. */
const TOAST_LIFETIME_MS = 8000;

/** How often to ask whether a running job has finished. */
const POLL_INTERVAL_MS = 3000;

const isFinished = (job: Job): boolean => job.status === 'SUCCEEDED' || job.status === 'FAILED';

const STATUS_LABELS: Record<JobStatus, string> = {
  PENDING: 'Queued',
  RUNNING: 'In progress',
  SUCCEEDED: 'Done',
  FAILED: 'Failed',
};

const STATUS_DOTS: Record<JobStatus, string> = {
  PENDING: 'run',
  RUNNING: 'run',
  SUCCEEDED: 'ok',
  FAILED: 'bad',
};

const OPERATION_ICONS: Record<DocumentJobKind, (size?: number) => ReactNode> = {
  REDACTION: BI.redact,
  OCR: BI.ocr,
  WATERMARK: BI.watermark,
  PDFA: BI.pdfa,
  PDFUA: BI.text,
  COMPRESS: BI.compress,
  FLATTEN: BI.flatten,
  ROTATE: BI.rotate,
  PROTECT: BI.protect,
  CONVERT: BI.convert,
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
 * Renders two rail sections, Tools and Activity, because they share the job
 * list: a job started here appears in Activity without waiting for a poll.
 *
 * Collapsed by default so that a document with no operations queued costs no
 * vertical space, and a fifth registered operation costs none either: it is
 * just one more row in a list that only appears once asked for.
 *
 * The job-polling, error handling and busy state below are carried over
 * unchanged from the single-purpose redaction panel this replaces — only the
 * controls are generic now.
 */
export function DocumentTools({
  documentId,
  canRunTools,
  operations,
  suggestOcr = false,
}: DocumentToolsProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ocr = operations.find((operation) => operation.kind === 'OCR');
  const ocrLanguageField = ocr?.fields.find((field) => field.kind === 'select');
  const [scanLanguage, setScanLanguage] = useState(
    ocrLanguageField?.kind === 'select' ? ocrLanguageField.defaultValue : ''
  );
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

  // Announce a job that finishes while the page is open. Compared against the
  // statuses seen last time, so history already finished on arrival is not news.
  const seenStatuses = useRef<Map<string, JobStatus>>(new Map());

  useEffect(() => {
    const seen = seenStatuses.current;
    const justFinished = jobs.filter((job) => {
      const before = seen.get(job.id);
      return (
        isFinished(job) && before !== undefined && before !== 'SUCCEEDED' && before !== 'FAILED'
      );
    });
    seenStatuses.current = new Map(jobs.map((job) => [job.id, job.status]));

    if (justFinished.length === 0) return;

    const fresh: Toast[] = justFinished.map((job) =>
      job.status === 'SUCCEEDED'
        ? {
            id: job.id,
            text: `${job.description} is ready`,
            tone: 'ok',
            href: job.outputDocumentId ? `/documents/${job.outputDocumentId}` : undefined,
          }
        : { id: job.id, text: `${job.description} failed`, tone: 'bad' }
    );
    setToasts((current) => [...current, ...fresh]);

    // Not cleared when `jobs` changes again: polling would otherwise cancel every
    // timer and the toasts would never leave.
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => !fresh.includes(toast)));
    }, TOAST_LIFETIME_MS);
  }, [jobs]);

  const dismissToast = (id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const showScanSuggestion =
    suggestOcr && canRunTools && ocr !== undefined && !jobs.some((job) => job.kind === 'OCR');

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

  const chooseOperation = (operation: OperationSummary) => {
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
  const buildRequestBody = (operation: OperationSummary): Record<string, unknown> => {
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

  /** Queue a job; true when the server accepted it. */
  const postJob = async (body: Record<string, unknown>): Promise<boolean> => {
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
        setError(result?.error ?? 'The job could not be started.');
        return false;
      }

      // Show it immediately rather than waiting for the next poll — the work may
      // already be running by the time the response arrives.
      setJobs((current) => [result.job as Job, ...current]);
      return true;
    } catch {
      setError('The job could not be started.');
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const runOperation = async () => {
    if (!selectedOperation) {
      return;
    }

    if (await postJob(buildRequestBody(selectedOperation))) {
      setRegex('');
    }
  };

  const needsRegexText =
    selectedOperation?.fields.some((field) => field.kind === 'preset-or-regex') === true &&
    useRegex;

  const canSubmit = !isBusy && (!needsRegexText || regex.trim().length > 0);

  return (
    <>
      {showScanSuggestion && (
        <div className="bnd-alert" style={{ background: 'var(--bg-elev)' }}>
          {BI.ocr(18)}
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <b>This looks like a scan</b>
              <p>Make it searchable, so its text can be found, selected and copied.</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {ocrLanguageField?.kind === 'select' && (
                <select
                  aria-label="Scan language"
                  className="bnd-input"
                  style={{ width: 'auto', flex: 1, minWidth: 120 }}
                  value={scanLanguage}
                  onChange={(event) => setScanLanguage(event.target.value)}
                >
                  {ocrLanguageField.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="btn sm"
                disabled={isBusy}
                onClick={() => void postJob({ kind: 'OCR', language: scanLanguage })}
              >
                Make searchable
              </button>
            </div>
            {/* The Tools form shows its own errors; this one has no form open. */}
            {error && !selectedOperation && (
              <p className="bnd-hint bad" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      {canRunTools && (
        <RailSection title="Tools" flush={!selectedOperation} open={isOpen} onToggle={toggleTools}>
          {menuOpen && (
            <ul className="bnd-tgroup" style={{ listStyle: 'none', margin: 0 }}>
              {operations.map((operation) => (
                <li key={operation.kind}>
                  <button
                    type="button"
                    onClick={() => chooseOperation(operation)}
                    className="bnd-trow"
                  >
                    <span className="bnd-tic">{OPERATION_ICONS[operation.kind](14)}</span>
                    <span style={{ minWidth: 0 }}>
                      <b>{operation.label}</b>
                      <small>{operation.description}</small>
                    </span>
                    <span className="chev">{BI.right(14)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedOperation && (
            <div className="bnd-tform">
              <button
                type="button"
                className="bnd-link"
                style={{ alignSelf: 'flex-start', display: 'inline-flex', gap: 4 }}
                onClick={() => {
                  setSelectedKind(null);
                  setMenuOpen(true);
                }}
              >
                {BI.left(12)} All tools
              </button>
              <div className="bnd-tform-h">
                <span className="bnd-tic">{OPERATION_ICONS[selectedOperation.kind](15)}</span>
                <div style={{ minWidth: 0 }}>
                  <b>{selectedOperation.label}</b>
                  <p>{selectedOperation.description}</p>
                </div>
              </div>

              {selectedOperation.fields.map((field) => {
                if (field.kind === 'select') {
                  return (
                    <div key={field.name} className="bnd-field">
                      <label htmlFor={`field-${field.name}`} className="bnd-lbl">
                        {field.label}
                      </label>
                      <select
                        id={`field-${field.name}`}
                        value={fieldValues[field.name] ?? field.defaultValue}
                        onChange={(event) => setFieldValue(field.name, event.target.value)}
                        className="bnd-input"
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
                    <div key={field.name} className="bnd-field">
                      <label htmlFor={`field-${field.name}`} className="bnd-lbl">
                        {field.label}
                      </label>
                      <input
                        id={`field-${field.name}`}
                        type={field.secret ? 'password' : 'text'}
                        // A new password for a new file: not one to fill from, or save to, the browser's store.
                        autoComplete={field.secret ? 'new-password' : undefined}
                        value={fieldValues[field.name] ?? ''}
                        onChange={(event) => setFieldValue(field.name, event.target.value)}
                        placeholder={field.placeholder}
                        maxLength={field.maxLength}
                        className="bnd-input"
                      />
                    </div>
                  );
                }

                // 'preset-or-regex' — redaction's existing form, carried over as-is.
                // A single select rather than the design's multi-select chips:
                // the job takes exactly one preset.
                return (
                  <div key={field.name} className="bnd-tform">
                    {!useRegex && (
                      <div className="bnd-field">
                        <label htmlFor={`field-${field.name}-preset`} className="bnd-lbl">
                          {field.label}
                        </label>
                        <select
                          id={`field-${field.name}-preset`}
                          value={preset}
                          onChange={(event) => setPreset(event.target.value as RedactionPreset)}
                          className="bnd-input"
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
                      <div className="bnd-field">
                        <label htmlFor={`field-${field.name}-regex`} className="bnd-lbl">
                          Regular expression
                        </label>
                        <input
                          id={`field-${field.name}-regex`}
                          type="text"
                          value={regex}
                          onChange={(event) => setRegex(event.target.value)}
                          placeholder="ACME-[0-9]{4}"
                          className="bnd-input bnd-mono"
                        />
                      </div>
                    )}

                    <label htmlFor={`field-${field.name}-use-regex`} className="bnd-check">
                      <input
                        id={`field-${field.name}-use-regex`}
                        type="checkbox"
                        checked={useRegex}
                        onChange={(event) => setUseRegex(event.target.checked)}
                      />
                      Use a pattern of my own
                    </label>

                    {useRegex && (
                      <label htmlFor={`field-${field.name}-case-sensitive`} className="bnd-check">
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
                );
              })}

              <div className="bnd-out">
                {BI.branch(13)}
                <span>Saves as a new document · original unchanged</span>
              </div>

              {error && (
                <p className="bnd-hint bad" role="alert" style={{ margin: 0 }}>
                  {error}
                </p>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={runOperation}
                  disabled={!canSubmit}
                  className="btn sm"
                >
                  {isBusy ? 'Starting…' : 'Run'}
                </button>
              </div>
            </div>
          )}
        </RailSection>
      )}

      <RailSection title="Activity" count={jobs.length || undefined} flush>
        {jobs.length === 0 ? (
          <p className="bnd-hint" style={{ margin: 0, padding: '0 14px 8px' }}>
            No jobs yet.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {jobs.map((job) => (
              <li key={job.id} className="bnd-job">
                <span className={`bnd-dot ${STATUS_DOTS[job.status]}`} />

                <div style={{ minWidth: 0 }}>
                  <b>{job.description}</b>
                  <div className="d">{STATUS_LABELS[job.status]}</div>
                  {job.status === 'FAILED' && job.error && (
                    <div className="e" style={{ overflowWrap: 'anywhere' }}>
                      {job.error}
                    </div>
                  )}
                </div>

                <div className="r">
                  {job.status === 'SUCCEEDED' && job.outputDocumentId && (
                    <Link href={`/documents/${job.outputDocumentId}`}>Open result</Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      {toasts.length > 0 && (
        <div className="bnd-toasts">
          {toasts.map((toast) => (
            <div key={toast.id} role="status" className="bnd-toast">
              <span className={`bnd-dot ${toast.tone}`} />
              <span style={{ flex: 1 }}>{toast.text}</span>
              {toast.href && <Link href={toast.href}>Open</Link>}
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismissToast(toast.id)}
                style={{ textDecoration: 'none' }}
              >
                {BI.x(14)}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
