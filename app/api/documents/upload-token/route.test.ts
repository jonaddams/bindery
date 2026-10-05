// @vitest-environment node

import type { HandleUploadBody } from '@vercel/blob/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const handleUpload = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
}));
vi.mock('@/lib/nutrient-config', () => ({
  nutrientConfig: () => ({
    limits: { maxUploadBytes: 100 * 1024 * 1024, allowedMimeTypes: ['application/pdf'] },
  }),
}));
vi.mock('@vercel/blob/client', () => ({
  handleUpload: (...a: unknown[]) => handleUpload(...a),
}));

const { POST } = await import('@/app/api/documents/upload-token/route');

type TokenRequest = {
  onBeforeGenerateToken: (
    pathname: string,
    clientPayload: string | null,
    multipart: boolean
  ) => Promise<unknown>;
};

// Stand in for the Blob SDK: ask our route's callback for a token, as the real
// handleUpload does, and surface whatever it decides.
const askForToken = (pathname: string) => {
  handleUpload.mockImplementation(async (options: TokenRequest) => {
    const constraints = await options.onBeforeGenerateToken(pathname, null, true);
    return { type: 'blob.generate-client-token', clientToken: 'token', constraints };
  });

  const body: HandleUploadBody = {
    type: 'blob.generate-client-token',
    payload: { pathname, multipart: true, clientPayload: null },
  };

  return POST(
    new Request('https://example.test/api/documents/upload-token', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ user: { id: 'user_jon' } });
});

describe('Granting a browser permission to stage an upload', () => {
  it('grants an upload into the uploader’s own folder, within this deployment’s limits', async () => {
    const response = await askForToken('uploads/user_jon/Invoice Lumen.pdf');

    expect(response.status).toBe(200);
    expect((await response.json()).constraints).toEqual(
      expect.objectContaining({
        maximumSizeInBytes: 100 * 1024 * 1024,
        allowedContentTypes: ['application/pdf'],
        addRandomSuffix: true,
      })
    );
  });

  it('refuses an upload into someone else’s folder', async () => {
    const response = await askForToken('uploads/user_someone_else/Invoice.pdf');

    expect(response.status).toBe(403);
  });

  it('answers 401 when nobody is signed in', async () => {
    requireAuth.mockRejectedValue(new Error('Authentication required'));

    const response = await askForToken('uploads/user_jon/Invoice Lumen.pdf');

    expect(response.status).toBe(401);
  });
});
