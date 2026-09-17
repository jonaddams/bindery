// @vitest-environment node

import { DocumentJobKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_OPERATIONS,
  operationFor,
  operationsFor,
  toOperationSummary,
} from '@/lib/operations';
import { REDACTION_PRESETS } from '@/lib/operations/redaction';
import type { OperationField } from '@/lib/operations/types';

/**
 * Recursively asserts that nothing in `value` is a function.
 *
 * This is the regression guard for the RSC serialization bug: a
 * `DocumentOperation` remains structurally assignable to `OperationSummary`
 * (an object with strictly fewer properties satisfies a `Pick` of itself), so
 * the type system alone would happily let `parse` sneak back across the
 * server/client boundary. Only a runtime check on the actual mapped values
 * catches that.
 */
const assertNoFunctions = (value: unknown, path = 'root'): void => {
  if (typeof value === 'function') {
    throw new Error(`${path} is a function — this must not cross the server/client boundary.`);
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoFunctions(item, `${path}[${index}]`);
    });
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assertNoFunctions(nested, `${path}.${key}`);
    }
  }
};

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

  it('produces a summary with no function anywhere in it, so it can cross to a Client Component', () => {
    // Built the same way app/documents/[id]/page.tsx builds it: every
    // registered operation, mapped through the same projection.
    const summaries = DOCUMENT_OPERATIONS.map(toOperationSummary);

    assertNoFunctions(summaries);
  });

  /**
   * A field's `name` and the property `parse` reads off the request body are
   * two independent facts with nothing tying them together — rename one and
   * everything still type-checks while the Run button silently gets a 400.
   * This builds the request the way `DocumentTools`'s submit path actually
   * would, for every registered operation, and checks `parse` accepts it.
   */
  const sampleValueFor = (field: Extract<OperationField, { kind: 'select' | 'text' }>): string => {
    if (field.kind === 'select') {
      return field.defaultValue;
    }

    // A short, valid sample within the field's own limit rather than the
    // component's empty starting value, which real text fields (watermark's
    // required, non-empty text) would reject.
    return 'Sample'.slice(0, field.maxLength);
  };

  it('parses successfully with the request its own fields would actually submit', () => {
    for (const operation of DOCUMENT_OPERATIONS) {
      const presetOrRegexField = operation.fields.find((field) => field.kind === 'preset-or-regex');

      // `preset-or-regex` is handled explicitly rather than folded into the
      // generic loop below: it is redaction's own strategy shape — not one
      // `body[field.name]` entry — assembled the way DocumentTools does for
      // its default (non-regex) selection.
      const body: Record<string, unknown> = presetOrRegexField
        ? { kind: operation.kind, strategy: 'preset', preset: REDACTION_PRESETS[0] }
        : { kind: operation.kind };

      for (const field of operation.fields) {
        if (field.kind === 'select' || field.kind === 'text') {
          body[field.name] = sampleValueFor(field);
        }
      }

      const result = operation.parse(body);

      expect(result.ok, `${operation.kind} rejected the request its own fields would submit`).toBe(
        true
      );
    }
  });
});
