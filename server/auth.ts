import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

interface TokenRow {
  token: string;
  expires_at: number;
}

export function getAdminPassword(): string | null {
  return process.env.STATICS_PASSWORD ?? null;
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}::${ip}`).digest('hex').slice(0, 16);
}

export function isPasswordConfigured(): boolean {
  const pw = getAdminPassword();
  return typeof pw === 'string' && pw.length >= 4;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function verifyPassword(input: string): boolean {
  const expected = getAdminPassword();
  if (!expected) return false;
  return constantTimeEquals(input, expected);
}

export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function newTokenExpiry(): number {
  return Date.now() + TOKEN_TTL_MS;
}

export function isTokenValid(token: string, expiresAt: number): boolean {
  if (Date.now() > expiresAt) return false;
  if (typeof token !== 'string' || token.length < 32) return false;
  return true;
}

export function extractToken(cookieHeader?: string): TokenRow | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const c of cookies) {
    const [k, v] = c.split('=');
    if (k === 'statics_token' && v) {
      const expires = parseInt(cookieHeader.match(/statics_token_expires=(\d+)/)?.[1] ?? '0', 10);
      return { token: decodeURIComponent(v), expires_at: expires };
    }
  }
  return null;
}