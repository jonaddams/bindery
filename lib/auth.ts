import type { ImpersonationMode, Prisma, UserRole } from '@prisma/client';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth-config';
import { prisma } from '@/lib/prisma';

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: UserRole;
  currentImpersonationMode?: ImpersonationMode;
};

/**
 * The current session, or null when nobody is signed in.
 *
 * BetterAuth returns `{ session, user }`; every caller here wants `{ user }`, so
 * the shape is normalised rather than passed straight through.
 *
 * `role` and `currentImpersonationMode` are read from the `users` row on **every
 * call**, rather than taken from the session record via BetterAuth's
 * `user.additionalFields`. That is deliberate and worth the extra query: the
 * admin role switcher writes to that row, and a session-cached value would make
 * the switcher appear to do nothing until the next sign-in.
 *
 * `id` always comes from the signed-in account's own row and is never derived
 * from `currentImpersonationMode`. Impersonation widens which documents you can
 * see; it does not change who you are. DWS records this id as a comment's
 * author and it is what a verified phone number binds to, so conflating the two
 * would post comments as someone else.
 */
export async function getSession(): Promise<{ user: SessionUser } | null> {
  const betterAuthSession = await auth.api.getSession({ headers: await headers() });

  if (!betterAuthSession?.user?.id) {
    return null;
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: betterAuthSession.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      currentImpersonationMode: true,
    },
  });

  if (!dbUser) {
    return null;
  }

  return {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      image: dbUser.image,
      role: dbUser.role,
      currentImpersonationMode: dbUser.currentImpersonationMode,
    },
  };
}

/**
 * Validates that a user session exists and returns the session.
 * Throws an error if no valid session is found.
 * Use this in API routes and server components to ensure authentication.
 *
 * **Do not reword the thrown message.** Every route under `app/api/` compares
 * `error.message` to the literal `'Authentication required'` to map this to a
 * 401; a different string turns each of them into a 500.
 */
export async function requireAuth() {
  const session = await getSession();

  if (!session?.user?.id) {
    throw new Error('Authentication required');
  }

  return session;
}

/**
 * Whether this person is currently wielding admin powers.
 *
 * **An allowlist, deliberately.** This used to read
 * `role === 'ADMIN' && mode !== 'SELF'` — a denylist, which fails *open*: every
 * value that was not `SELF` granted full access. The enum's third value, `USER`,
 * therefore *widened* an admin's access while being the one mode whose purpose
 * was to narrow it, and the only one besides `SELF` the API would accept. So the
 * button labelled "User" gave more power than the one labelled "Admin".
 *
 * `USER` has since been removed from the enum, but the shape of the check is
 * what actually matters: written this way, a mode nobody has handled yet
 * restricts rather than grants. There are tests asserting exactly that against
 * an unrecognised value.
 *
 * `ADMIN` is the only mode that grants, and `SELF` — the default — means "show
 * me only what is mine", which is what an admin switches to in order to see the
 * application as an ordinary user does.
 */
const isActingAsAdmin = (user: SessionUser): boolean =>
  user.role === 'ADMIN' && user.currentImpersonationMode === 'ADMIN';

/**
 * Which documents a user may read: their own, plus any shared with them.
 *
 * Admins acting as admins see everything and need no clause at all.
 *
 * **This returns an `OR`, so never assign to `.OR` on a where-clause built from
 * it** — that replaces the access rule instead of narrowing it, and every
 * document becomes visible. Combine with `AND`, as the list route does.
 */
export function getEffectiveDocumentFilter(user: SessionUser): Prisma.DocumentWhereInput {
  if (isActingAsAdmin(user)) {
    return {}; // Every document.
  }

  // Owned or shared. A mention grants a share, so a notification cannot point
  // someone at a document they would then be refused.
  return {
    OR: [{ ownerId: user.id }, { shares: { some: { userId: user.id } } }],
  };
}

/**
 * Which documents a user may change or delete: their own only.
 *
 * Deliberately narrower than {@link getEffectiveDocumentFilter}. A share is read
 * access, and it is handed out automatically to anyone who gets mentioned — so
 * reusing the read filter here would mean mentioning someone let them rename or
 * delete the document they were invited to look at.
 *
 * Admins acting as admins can still change anything.
 */
export function getDocumentWriteFilter(user: SessionUser): Prisma.DocumentWhereInput {
  if (isActingAsAdmin(user)) {
    return {};
  }

  return { ownerId: user.id };
}

/**
 * Checks if a user can perform admin actions (create admin users, etc.)
 */
export function canPerformAdminActions(user: SessionUser) {
  return isActingAsAdmin(user);
}
