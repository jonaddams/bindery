// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  canPerformAdminActions,
  getDocumentWriteFilter,
  getEffectiveDocumentFilter,
  type SessionUser,
} from '@/lib/auth';

const getMockSessionUser = (overrides: Partial<SessionUser> = {}): SessionUser => ({
  id: 'user_123',
  email: 'someone@nutrient.io',
  name: 'Someone',
  role: 'USER',
  currentImpersonationMode: 'SELF',
  ...overrides,
});

describe('Document visibility', () => {
  it('limits a regular user to documents they own', () => {
    const user = getMockSessionUser({ id: 'user_abc', role: 'USER' });

    expect(getEffectiveDocumentFilter(user)).toEqual({
      OR: [{ ownerId: 'user_abc' }, { shares: { some: { userId: 'user_abc' } } }],
    });
  });

  it('limits an admin to their own documents while impersonating a user', () => {
    const user = getMockSessionUser({
      id: 'admin_abc',
      role: 'ADMIN',
      currentImpersonationMode: 'SELF',
    });

    expect(getEffectiveDocumentFilter(user)).toEqual({
      OR: [{ ownerId: 'admin_abc' }, { shares: { some: { userId: 'admin_abc' } } }],
    });
  });

  it('shows an admin every document when acting as an admin', () => {
    const user = getMockSessionUser({ role: 'ADMIN', currentImpersonationMode: 'ADMIN' });

    expect(getEffectiveDocumentFilter(user)).toEqual({});
  });

  // Inverted deliberately. This used to assert that a missing mode showed an
  // admin every document, which was the fail-open behaviour rather than an
  // intention: `undefined !== 'SELF'` was true, so absence granted everything.
  // A permission check should never read "I don't know, so yes" — and the column
  // defaults to SELF, so absence means a malformed session, not a choice.
  it('limits an admin to their own documents when no impersonation mode is recorded', () => {
    const user = getMockSessionUser({
      id: 'admin_abc',
      role: 'ADMIN',
      currentImpersonationMode: undefined,
    });

    expect(getEffectiveDocumentFilter(user)).toEqual({
      OR: [{ ownerId: 'admin_abc' }, { shares: { some: { userId: 'admin_abc' } } }],
    });
  });

  it('limits a regular user to their own documents regardless of impersonation mode', () => {
    const user = getMockSessionUser({
      id: 'user_xyz',
      role: 'USER',
      currentImpersonationMode: 'ADMIN',
    });

    expect(getEffectiveDocumentFilter(user)).toEqual({
      OR: [{ ownerId: 'user_xyz' }, { shares: { some: { userId: 'user_xyz' } } }],
    });
  });

  it('includes documents shared with the user, not only ones they own', () => {
    const user = getMockSessionUser({ id: 'user_carson', role: 'USER' });

    const filter = getEffectiveDocumentFilter(user);

    expect(filter.OR).toContainEqual({ shares: { some: { userId: 'user_carson' } } });
  });

  it('does not widen an admin filter with a share clause, since they see everything', () => {
    const user = getMockSessionUser({ role: 'ADMIN', currentImpersonationMode: 'ADMIN' });

    expect(getEffectiveDocumentFilter(user)).toEqual({});
  });
});

describe('Changing or deleting a document', () => {
  it('does not let someone edit a document merely shared with them', () => {
    const user = getMockSessionUser({ id: 'user_carson', role: 'USER' });

    // Read access is owned-or-shared; write access is ownership alone. A share
    // arrives by being mentioned, which must not confer rename or delete.
    expect(getDocumentWriteFilter(user)).toEqual({ ownerId: 'user_carson' });
    expect(JSON.stringify(getDocumentWriteFilter(user))).not.toContain('shares');
  });

  it('still lets an admin acting as an admin change any document', () => {
    const user = getMockSessionUser({ role: 'ADMIN', currentImpersonationMode: 'ADMIN' });

    expect(getDocumentWriteFilter(user)).toEqual({});
  });

  it('limits an admin impersonating a user to documents they own', () => {
    const user = getMockSessionUser({
      id: 'admin_abc',
      role: 'ADMIN',
      currentImpersonationMode: 'SELF',
    });

    expect(getDocumentWriteFilter(user)).toEqual({ ownerId: 'admin_abc' });
  });

  it('is narrower than read access for the same user', () => {
    const user = getMockSessionUser({ id: 'user_bob', role: 'USER' });

    expect(getDocumentWriteFilter(user)).not.toEqual(getEffectiveDocumentFilter(user));
  });
});

describe('Admin action permissions', () => {
  it('allows an admin acting as an admin to perform admin actions', () => {
    const user = getMockSessionUser({ role: 'ADMIN', currentImpersonationMode: 'ADMIN' });

    expect(canPerformAdminActions(user)).toBe(true);
  });

  it('denies admin actions to an admin who is impersonating a user', () => {
    const user = getMockSessionUser({ role: 'ADMIN', currentImpersonationMode: 'SELF' });

    expect(canPerformAdminActions(user)).toBe(false);
  });

  it('denies admin actions to a regular user', () => {
    const user = getMockSessionUser({ role: 'USER', currentImpersonationMode: 'ADMIN' });

    expect(canPerformAdminActions(user)).toBe(false);
  });
});

/**
 * These three assert the same property from three angles, and it is the one that
 * actually went wrong: the checks used to read `mode !== 'SELF'`, a denylist, so
 * *any* value that was not SELF granted full access. The enum's third value,
 * `USER`, therefore widened an admin's access — while being the one mode whose
 * entire purpose was to narrow it, and the only one besides SELF the API would
 * accept.
 *
 * Written against a deliberately invalid mode rather than against `USER`,
 * because `USER` is gone and the point is the shape of the check, not that one
 * value. A permission check has to fail closed: an unrecognised mode must
 * restrict, never grant.
 */
describe('An unrecognised impersonation mode', () => {
  // The cast is the point of the test: it stands in for a value the type system
  // forbids today and a future migration might add.
  const unknownMode = 'SOMETHING_NEW' as SessionUser['currentImpersonationMode'];

  it('does not widen what an admin can read', () => {
    const user = getMockSessionUser({
      id: 'admin_abc',
      role: 'ADMIN',
      currentImpersonationMode: unknownMode,
    });

    expect(getEffectiveDocumentFilter(user)).toEqual({
      OR: [{ ownerId: 'admin_abc' }, { shares: { some: { userId: 'admin_abc' } } }],
    });
  });

  it('does not widen what an admin can change', () => {
    const user = getMockSessionUser({
      id: 'admin_abc',
      role: 'ADMIN',
      currentImpersonationMode: unknownMode,
    });

    expect(getDocumentWriteFilter(user)).toEqual({ ownerId: 'admin_abc' });
  });

  it('does not grant admin actions', () => {
    const user = getMockSessionUser({ role: 'ADMIN', currentImpersonationMode: unknownMode });

    expect(canPerformAdminActions(user)).toBe(false);
  });
});
