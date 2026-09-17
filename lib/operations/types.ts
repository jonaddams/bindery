import type { DocumentJobKind } from '@prisma/client';
import type { ProcessInstructions } from '@/lib/document-provider';
import type { NutrientTarget } from '@/lib/nutrient-config';

export type OperationFieldOption = { value: string; label: string };

/**
 * What the UI renders for an operation, declared by the operation itself.
 *
 * A schema rather than a component per operation: with one field each, a
 * component apiece would be more code and a second place for the registry and
 * the UI to disagree.
 */
export type OperationField =
  | {
      kind: 'select';
      name: string;
      label: string;
      options: readonly OperationFieldOption[];
      defaultValue: string;
    }
  | { kind: 'text'; name: string; label: string; placeholder: string; maxLength: number }
  /**
   * Redaction's preset-dropdown-plus-custom-regex form, which does not fit a
   * flat field list. Named as an exception rather than contorting the schema for
   * the other three.
   */
  | { kind: 'preset-or-regex'; name: string; label: string };

/**
 * The result of validating a request for one operation.
 *
 * Returns a *closure* rather than a parameters object, which is what lets one
 * registry hold operations with different parameter types and no cast: each
 * module validates its own input and hands back something that can only build
 * valid instructions.
 */
export type OperationParseResult =
  | {
      ok: true;
      buildInstructions: (options: { filePartName: string }) => ProcessInstructions;
      /** Appended to the source filename to name the output. */
      outputSuffix: string;
    }
  | { ok: false; message: string };

export type DocumentOperation = {
  kind: DocumentJobKind;
  label: string;
  description: string;
  /** Which backends can perform this. Lives here so there is no parallel list to drift. */
  backends: readonly NutrientTarget[];
  fields: readonly OperationField[];
  parse(raw: unknown): OperationParseResult;
};
