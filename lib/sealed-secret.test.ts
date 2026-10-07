// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { seal, unseal } from '@/lib/sealed-secret';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Sealing a secret for storage', () => {
  it('opens again with the same server secret', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'server-secret-one');

    expect(unseal(seal('hunter2'))).toBe('hunter2');
  });

  it('does not contain the secret in readable form', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'server-secret-one');

    expect(seal('hunter2')).not.toContain('hunter2');
  });

  it('seals the same secret differently each time', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'server-secret-one');

    expect(seal('hunter2')).not.toBe(seal('hunter2'));
  });

  it('cannot be opened once the server secret changes', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'server-secret-one');
    const sealed = seal('hunter2');

    vi.stubEnv('BETTER_AUTH_SECRET', 'server-secret-two');

    expect(unseal(sealed)).toBeUndefined();
  });

  it('cannot be opened after tampering', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'server-secret-one');
    const sealed = seal('hunter2');
    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith('A') ? 'B' : 'A'}=`;

    expect(unseal(tampered)).toBeUndefined();
  });

  it('opens nothing that was not sealed here', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'server-secret-one');

    expect(unseal('hunter2')).toBeUndefined();
  });

  // A documented-but-unset variable arrives as '' (see CLAUDE.md), and sealing
  // with an empty key would protect nothing.
  it('refuses to seal without a server secret', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '');

    expect(() => seal('hunter2')).toThrow(/BETTER_AUTH_SECRET/);
  });
});
