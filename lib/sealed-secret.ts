import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encrypt a short secret so it can sit in Postgres until a job runs.
 *
 * Exists for password-protect jobs: the runner reads a job's parameters back
 * from the database — possibly from the cron sweep, long after the request — so
 * the password has to be stored, and a plaintext password in Neon is not
 * acceptable. AES-256-GCM, so tampering is detected rather than decrypting to
 * garbage.
 *
 * The key is derived from `BETTER_AUTH_SECRET` rather than a variable of its
 * own: one fewer secret to provision and keep in step across environments.
 * Rotating it makes still-queued protect jobs fail with a reason, which is the
 * whole cost — a finished job's output holds the password, not the database.
 */

const VERSION = 'v1';

const key = (): Buffer => {
  const secret = process.env.BETTER_AUTH_SECRET;

  // Falsiness, not nullishness: a documented-but-unset variable arrives as ''.
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is not set, so a secret cannot be sealed for storage.');
  }

  return createHash('sha256').update(`bindery sealed job parameter\0${secret}`).digest();
};

export const seal = (plaintext: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
    .join(':');
};

/** The plaintext, or undefined when this server cannot open it. */
export const unseal = (sealed: string): string | undefined => {
  const [version, iv, tag, ciphertext] = sealed.split(':');

  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    return undefined;
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return undefined;
  }
};
