/**
 * What a password-protect job asks the Processor API to do.
 *
 * Protection is part of the output: `user_password`, `owner_password` and
 * `user_permissions` on `{"type": "pdf"}` — snake_case, unlike the rest of the
 * instructions. Verified on both backends
 * (`docs/superpowers/specs/2026-10-07-build-api-shapes-more.md`): the copy opens
 * only with the user password, and `qpdf --show-encryption` lists exactly the
 * granted permissions.
 *
 * **The owner password is generated, not asked for.** Without one, the open
 * password unlocks everything and the chosen restrictions mean nothing. A random
 * one makes them hold — and nobody can lift them on this copy, which is fine:
 * the original is never touched.
 *
 * **Both passwords are sealed before they are stored** (`lib/sealed-secret.ts`):
 * the runner parses a job's parameters back out of Postgres, possibly long after
 * the request, so they have to be stored, and not in plain text.
 */

import { randomBytes } from 'node:crypto';
import {
  asRecord,
  type DocumentOperation,
  type OperationParseResult,
} from '@/lib/operations/types';
import { seal, unseal } from '@/lib/sealed-secret';

export const PROTECT_PASSWORD_MIN_LENGTH = 6;
export const PROTECT_PASSWORD_MAX_LENGTH = 64;

/** Every name both backends accept is listed in the shapes document; these are the useful sets. */
const PERMISSIONS = {
  print: { label: 'Printing allowed', granted: ['printing'] },
  'print-and-forms': {
    label: 'Printing and form filling allowed',
    granted: ['printing', 'fill_forms'],
  },
  view: { label: 'View only', granted: [] },
} as const;

type PermissionSet = keyof typeof PERMISSIONS;

const isPermissionSet = (value: unknown): value is PermissionSet =>
  typeof value === 'string' && Object.hasOwn(PERMISSIONS, value);

const protectedJob = (options: {
  permissions: PermissionSet;
  password: string;
  ownerPassword: string;
}): OperationParseResult => {
  const { permissions, password, ownerPassword } = options;
  const { label, granted } = PERMISSIONS[permissions];

  return {
    ok: true,
    outputSuffix: 'protected',
    summary: label,
    parameters: {
      permissions,
      sealedPassword: seal(password),
      sealedOwnerPassword: seal(ownerPassword),
    },
    buildInstructions: ({ filePartName }) => ({
      parts: [{ file: filePartName }],
      actions: [],
      output: {
        type: 'pdf',
        user_password: password,
        owner_password: ownerPassword,
        user_permissions: [...granted],
      },
    }),
  };
};

export const protectOperation: DocumentOperation = {
  kind: 'PROTECT',
  label: 'Password-protect',
  description: 'Require a password to open the copy, and limit what it allows.',
  backends: ['dws', 'document-engine'],
  fields: [
    {
      kind: 'text',
      name: 'password',
      label: 'Password to open',
      placeholder: `At least ${PROTECT_PASSWORD_MIN_LENGTH} characters`,
      maxLength: PROTECT_PASSWORD_MAX_LENGTH,
      secret: true,
    },
    {
      kind: 'select',
      name: 'permissions',
      label: 'Once opened',
      options: Object.entries(PERMISSIONS).map(([value, { label }]) => ({ value, label })),
      defaultValue: 'print',
    },
  ],
  parse: (raw) => {
    const request = asRecord(raw);
    const permissions = request?.permissions;

    if (!isPermissionSet(permissions)) {
      return {
        ok: false,
        message: `"${String(permissions)}" is not a permission set. Use one of: ${Object.keys(PERMISSIONS).join(', ')}.`,
      };
    }

    // Read back from storage: both passwords were sealed when the job was queued.
    if (typeof request?.sealedPassword === 'string') {
      const password = unseal(request.sealedPassword);
      const ownerPassword =
        typeof request.sealedOwnerPassword === 'string'
          ? unseal(request.sealedOwnerPassword)
          : undefined;

      if (password === undefined || ownerPassword === undefined) {
        return {
          ok: false,
          message:
            'The password stored for this job can no longer be read — the server secret has ' +
            'changed since it was queued. Protect the document again.',
        };
      }

      return protectedJob({ permissions, password, ownerPassword });
    }

    const password = request?.password;

    if (
      typeof password !== 'string' ||
      password.length < PROTECT_PASSWORD_MIN_LENGTH ||
      password.length > PROTECT_PASSWORD_MAX_LENGTH
    ) {
      return {
        ok: false,
        message: `The password must be ${PROTECT_PASSWORD_MIN_LENGTH} to ${PROTECT_PASSWORD_MAX_LENGTH} characters long.`,
      };
    }

    return protectedJob({
      permissions,
      password,
      ownerPassword: randomBytes(24).toString('base64url'),
    });
  },
};
