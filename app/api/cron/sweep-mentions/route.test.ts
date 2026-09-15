// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sweepMentions = vi.fn();

vi.mock('@/lib/mention-sweeper', () => ({
  sweepMentions: (...a: unknown[]) => sweepMentions(...a),
}));

const { GET } = await import('@/app/api/cron/sweep-mentions/route');

const get = (headers: Record<string, string> = {}) =>
  GET(new Request('https://example.test/api/cron/sweep-mentions', { headers }) as never);

beforeEach(() => {
  vi.clearAllMocks();
  sweepMentions.mockResolvedValue({ swept: 3, sent: 1, failed: 0 });
  vi.stubEnv('CRON_SECRET', 'the-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('The scheduled mention sweep', () => {
  it('runs the sweep and reports what it found', async () => {
    const response = await get({ Authorization: 'Bearer the-secret' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ swept: 3, sent: 1 }));
    expect(sweepMentions).toHaveBeenCalled();
  });

  // It reads every document's comments from DWS and can send email and SMS, so
  // the shared secret is the only thing standing in front of real spend.
  it('refuses a caller that does not present the secret', async () => {
    expect((await get()).status).toBe(401);
    expect(sweepMentions).not.toHaveBeenCalled();
  });

  it('refuses a caller presenting the wrong secret', async () => {
    expect((await get({ Authorization: 'Bearer guess' })).status).toBe(401);
    expect(sweepMentions).not.toHaveBeenCalled();
  });

  it('refuses everything when no secret is configured, rather than running openly', async () => {
    vi.stubEnv('CRON_SECRET', '');

    expect((await get({ Authorization: 'Bearer the-secret' })).status).toBe(503);
    expect(sweepMentions).not.toHaveBeenCalled();
  });

  it('reports a sweep that failed outright', async () => {
    sweepMentions.mockRejectedValue(new Error('database unreachable'));

    expect((await get({ Authorization: 'Bearer the-secret' })).status).toBe(500);
  });
});
