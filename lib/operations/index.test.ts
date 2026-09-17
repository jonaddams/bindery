// @vitest-environment node

import { DocumentJobKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_OPERATIONS, operationFor, operationsFor } from '@/lib/operations';

describe('The operation registry', () => {
  it('has exactly one operation for every job kind the schema allows', () => {
    // A kind with no operation is a job that can be created and never run.
    const kinds = DOCUMENT_OPERATIONS.map((operation) => operation.kind).sort();
    expect(kinds).toEqual(Object.values(DocumentJobKind).sort());
  });

  it('does not repeat a kind or a label', () => {
    const kinds = DOCUMENT_OPERATIONS.map((operation) => operation.kind);
    const labels = DOCUMENT_OPERATIONS.map((operation) => operation.label);

    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every operation at least one backend, so none is unreachable', () => {
    for (const operation of DOCUMENT_OPERATIONS) {
      expect(operation.backends.length).toBeGreaterThan(0);
    }
  });

  it('finds an operation by kind', () => {
    expect(operationFor('REDACTION')?.label).toBe('Redact');
  });

  it('offers only the operations a backend supports', () => {
    const supported = operationsFor('dws').map((operation) => operation.kind);

    expect(supported).toContain('REDACTION');
    for (const operation of operationsFor('dws')) {
      expect(operation.backends).toContain('dws');
    }
  });
});
