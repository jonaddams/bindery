// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sweepJobs = vi.fn();

vi.mock('@/lib/job-runner', () => ({
  sweepJobs: (...a: unknown[]) => sweepJobs(...a),
}));

const { GET } = await import('@/app/api/cron/sweep-jobs/route');

const get = (headers: Record<string, string> = {}) =>
  GET(new Request('https://example.test/api/cron/sweep-jobs', { headers }) as never);

beforeEach(() => {
  vi.clearAllMocks();
  sweepJobs.mockResolvedValue({ considered: 3 });
  vi.stubEnv('CRON_SECRET', 'the-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('The scheduled sweep', () => {
  it('runs the sweep and reports what it took on', async () => {
    const response = await get({ Authorization: 'Bearer the-secret' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ considered: 3 }));
    expect(sweepJobs).toHaveBeenCalled();
  });

  // This endpoint runs billed work and is unauthenticated in the session sense,
  // so the shared secret is the only thing standing in front of it.
  it('refuses a caller that does not present the secret', async () => {
    const response = await get();

    expect(response.status).toBe(401);
    expect(sweepJobs).not.toHaveBeenCalled();
  });

  it('refuses a caller presenting the wrong secret', async () => {
    const response = await get({ Authorization: 'Bearer guess' });

    expect(response.status).toBe(401);
    expect(sweepJobs).not.toHaveBeenCalled();
  });

  // Refusing everything is the safe failure here. Running the sweep when no
  // secret is configured would leave the endpoint open on any deployment that
  // forgot to set one — which is precisely the deployment least able to notice.
  it('refuses everything when no secret is configured, rather than running openly', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await get({ Authorization: 'Bearer the-secret' });

    expect(response.status).toBe(503);
    expect(sweepJobs).not.toHaveBeenCalled();
  });

  it('reports a sweep that failed outright', async () => {
    sweepJobs.mockRejectedValue(new Error('database unreachable'));

    const response = await get({ Authorization: 'Bearer the-secret' });

    expect(response.status).toBe(500);
  });
});
