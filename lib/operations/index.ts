import type { DocumentJobKind } from '@prisma/client';
import type { NutrientTarget } from '@/lib/nutrient-config';
import { ocrOperation } from '@/lib/operations/ocr';
import { pdfaOperation } from '@/lib/operations/pdfa';
import { redactionOperation } from '@/lib/operations/redaction';
import type { DocumentOperation, OperationSummary } from '@/lib/operations/types';
import { watermarkOperation } from '@/lib/operations/watermark';

export type {
  DocumentOperation,
  OperationField,
  OperationParseResult,
  OperationSummary,
} from '@/lib/operations/types';

/** Every operation this app implements. Order is the order the menu shows. */
export const DOCUMENT_OPERATIONS: readonly DocumentOperation[] = [
  redactionOperation,
  ocrOperation,
  watermarkOperation,
  pdfaOperation,
];

export const operationFor = (kind: DocumentJobKind): DocumentOperation | undefined =>
  DOCUMENT_OPERATIONS.find((operation) => operation.kind === kind);

/**
 * A job as job history should name it: "Redact · Email addresses".
 *
 * Parsed from the stored parameters, so it says what actually ran. Falls back to
 * the operation's label when they no longer parse — a job written by older code
 * should still be listed, just less specifically.
 */
export const describeJob = (job: { kind: DocumentJobKind; parameters: unknown }): string => {
  const operation = operationFor(job.kind);

  if (!operation) {
    return job.kind;
  }

  const parsed = operation.parse(job.parameters);

  return parsed.ok && parsed.summary ? `${operation.label} · ${parsed.summary}` : operation.label;
};

/** What this deployment can offer, which is not the same as what it implements. */
export const operationsFor = (target: NutrientTarget): readonly DocumentOperation[] =>
  DOCUMENT_OPERATIONS.filter((operation) => operation.backends.includes(target));

/**
 * Project an operation down to what a Client Component may hold.
 *
 * `parse` is a function, and a server component cannot pass a function to a
 * Client Component — React throws at request time, which `next build` and
 * `tsc` both miss. `backends` is dropped too: by the time a caller has an
 * operation in hand it was already filtered by `operationsFor`, so the field
 * has nothing left to say to the browser.
 */
export const toOperationSummary = (operation: DocumentOperation): OperationSummary => {
  const { kind, label, description, fields } = operation;
  return { kind, label, description, fields };
};
