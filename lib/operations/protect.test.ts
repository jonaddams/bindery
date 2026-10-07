// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { protectOperation } from '@/lib/operations/protect';

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_SECRET', 'server-secret-one');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const parsedOk = (request: Record<string, unknown>) => {
  const result = protectOperation.parse({ kind: 'PROTECT', ...request });
  if (!result.ok) throw new Error(result.message);
  return result;
};

const outputOf = (request: Record<string, unknown>) =>
  parsedOk(request).buildInstructions({ filePartName: 'document' }).output ?? {};

describe('Password-protecting a document', () => {
  it('requires the typed password to open the copy', () => {
    expect(outputOf({ password: 'open-sesame', permissions: 'print' })).toEqual(
      expect.objectContaining({ type: 'pdf', user_password: 'open-sesame' })
    );
  });

  it('grants only the permissions chosen', () => {
    expect(outputOf({ password: 'open-sesame', permissions: 'print' }).user_permissions).toEqual([
      'printing',
    ]);
    expect(outputOf({ password: 'open-sesame', permissions: 'view' }).user_permissions).toEqual([]);
  });

  // Without an owner password the open password unlocks everything, and the
  // chosen restrictions would mean nothing.
  it('sets an owner password of its own, distinct from the one typed', () => {
    const output = outputOf({ password: 'open-sesame', permissions: 'print' });

    expect(typeof output.owner_password).toBe('string');
    expect(String(output.owner_password).length).toBeGreaterThanOrEqual(32);
    expect(output.owner_password).not.toBe('open-sesame');
  });

  it('never stores either password in readable form', () => {
    const { parameters, buildInstructions } = parsedOk({
      password: 'open-sesame',
      permissions: 'print',
    });
    const owner = String(buildInstructions({ filePartName: 'document' }).output?.owner_password);
    const stored = JSON.stringify(parameters);

    expect(stored).not.toContain('open-sesame');
    expect(stored).not.toContain(owner);
  });

  it('runs from what it stored, with the same passwords', () => {
    const requested = parsedOk({ password: 'open-sesame', permissions: 'print' });
    const restored = parsedOk(requested.parameters);

    expect(restored.buildInstructions({ filePartName: 'document' })).toEqual(
      requested.buildInstructions({ filePartName: 'document' })
    );
  });

  it('describes the permissions in job history, never the password', () => {
    const { summary } = parsedOk({ password: 'open-sesame', permissions: 'print' });

    expect(summary).toBe('Printing allowed');
    expect(summary).not.toContain('open-sesame');
  });

  it('refuses a password too short to be worth having', () => {
    const result = protectOperation.parse({
      kind: 'PROTECT',
      password: 'abc',
      permissions: 'print',
    });

    expect(result.ok).toBe(false);
  });

  it('refuses permissions it does not offer', () => {
    const result = protectOperation.parse({
      kind: 'PROTECT',
      password: 'open-sesame',
      permissions: 'everything',
    });

    expect(result.ok).toBe(false);
  });

  // If the server secret is rotated while a job is queued, the job must fail
  // with a reason rather than protect the copy with a garbled password.
  it('cannot run a stored job whose passwords no longer open', () => {
    const { parameters } = parsedOk({ password: 'open-sesame', permissions: 'print' });

    vi.stubEnv('BETTER_AUTH_SECRET', 'server-secret-two');
    const result = protectOperation.parse(parameters);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/password/i);
  });
});
