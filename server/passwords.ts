import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const rest = stored.slice('scrypt$'.length);
  const sep = rest.indexOf('$');
  if (sep === -1) return false;
  const saltHex = rest.slice(0, sep);
  const hashHex = rest.slice(sep + 1);
  if (saltHex.length === 0 || hashHex.length === 0) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const derived = scryptSync(plain, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
