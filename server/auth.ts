import { createHash, randomBytes } from 'node:crypto';
import { runStmt, queryAll } from './db.js';
import { getUserById, type UserRow } from './users.js';

export const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

export interface AuthedUser {
  id: number;
  username: string;
  role: 'admin' | 'merchant';
  mustChangePassword: number;
  expiresAt: number | null;
}

export interface IssuedToken {
  token: string;
  expiresAt: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueSession(userId: number): IssuedToken {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  runStmt(
    `INSERT INTO auth_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    [hashToken(token), userId, expiresAt, Date.now()]
  );
  return { token, expiresAt };
}

function extract(req: { headers?: { cookie?: string } }): { token: string; expiresAt: number } | null {
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  let token: string | null = null;
  let expiresAt = 0;
  for (const c of cookies) {
    const eq = c.indexOf('=');
    if (eq === -1) continue;
    const k = c.slice(0, eq);
    const v = c.slice(eq + 1);
    if (k === 'statics_token' && v) token = decodeURIComponent(v);
    if (k === 'statics_token_expires' && v) expiresAt = parseInt(v, 10) || 0;
  }
  if (!token) return null;
  return { token, expiresAt };
}

export function verifySessionFromRequest(req: { headers?: { cookie?: string } }): AuthedUser | null {
  const t = extract(req);
  if (!t) return null;
  if (Date.now() > t.expiresAt) return null;
  const rows = queryAll<{ user_id: number; expires_at: number }>(
    `SELECT user_id, expires_at FROM auth_tokens WHERE token_hash = ?`,
    [hashToken(t.token)]
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() > row.expires_at) return null;
  const u: UserRow | null = getUserById(row.user_id);
  if (!u) return null;
  if (u.disabled) return null;
  if (u.expiresAt != null && Date.now() > u.expiresAt) return null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
    expiresAt: u.expiresAt,
  };
}

export function clearSessionForCurrentToken(req: { headers?: { cookie?: string } }): void {
  const t = extract(req);
  if (!t) return;
  runStmt(`DELETE FROM auth_tokens WHERE token_hash = ?`, [hashToken(t.token)]);
}

export function clearSessionForUser(userId: number): void {
  runStmt(`DELETE FROM auth_tokens WHERE user_id = ?`, [userId]);
}

export const COOKIE_NAME = 'statics_token';
export const COOKIE_EXPIRES = 'statics_token_expires';

export function setAuthCookies(res: { cookie: (n: string, v: string, opts: object) => void }, issued: IssuedToken): void {
  const opts = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: issued.expiresAt - Date.now(),
    path: '/',
  };
  res.cookie(COOKIE_NAME, issued.token, opts);
  res.cookie(COOKIE_EXPIRES, String(issued.expiresAt), opts);
}

export function clearAuthCookies(res: { clearCookie: (n: string, opts: object) => void }): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.clearCookie(COOKIE_EXPIRES, { path: '/' });
}
