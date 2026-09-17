import type { DocumentJobKind } from '@prisma/client';
import type { NutrientTarget } from '@/lib/nutrient-config';
import { ocrOperation } from '@/lib/operations/ocr';
import { redactionOperation } from '@/lib/operations/redaction';
import type { DocumentOperation } from '@/lib/operations/types';

export type {
  DocumentOperation,
  OperationField,
  OperationParseResult,
} from '@/lib/operations/types';

/** Every operation this app implements. Order is the order the menu shows. */
export const DOCUMENT_OPERATIONS: readonly DocumentOperation[] = [redactionOperation, ocrOperation];

export const operationFor = (kind: DocumentJobKind): DocumentOperation | undefined =>
  DOCUMENT_OPERATIONS.find((operation) => operation.kind === kind);

/** What this deployment can offer, which is not the same as what it implements. */
export const operationsFor = (target: NutrientTarget): readonly DocumentOperation[] =>
  DOCUMENT_OPERATIONS.filter((operation) => operation.backends.includes(target));
