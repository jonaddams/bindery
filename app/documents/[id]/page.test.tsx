// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const findUniqueDocument = vi.fn();
const findFirstDocument = vi.fn();

// Next signals both of these by throwing; stand-ins that throw distinguishable
// errors let a test see which one the page chose.
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  getEffectiveDocumentFilter: () => ({}),
  getDocumentWriteFilter: () => ({}),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      findUnique: (...a: unknown[]) => findUniqueDocument(...a),
      findFirst: (...a: unknown[]) => findFirstDocument(...a),
    },
  },
}));
vi.mock('@/lib/nutrient-config', () => ({ nutrientConfig: () => ({ target: 'dws' }) }));

const { default: DocumentView } = await import('@/app/documents/[id]/page');

const open = (id = 'doc_1') => DocumentView({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ user: { id: 'user_jon', email: 'jon@nutrient.io' } });
});

describe('Opening a document', () => {
  // A deleted document, or a stale link, used to land on the sign-in page: the
  // not-found signal was thrown inside a try whose catch redirected to sign-in.
  it('says the document was not found when it does not exist', async () => {
    findUniqueDocument.mockResolvedValue(null);

    await expect(open()).rejects.toThrow('NOT_FOUND');
  });

  it('says the document was not found when the reader may not see it', async () => {
    findUniqueDocument.mockResolvedValue({ id: 'doc_1' });
    findFirstDocument.mockResolvedValue(null);

    await expect(open()).rejects.toThrow('NOT_FOUND');
  });

  it('sends someone who is not signed in to sign in', async () => {
    requireAuth.mockRejectedValue(new Error('Authentication required'));

    await expect(open()).rejects.toThrow('REDIRECT /auth/signin');
  });
});
