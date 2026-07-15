import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

let dbPath = '';

async function freshDb() {
  dbPath = join(tmpdir(), `auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.STATS_DB_PATH = dbPath;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db;
}

beforeEach(() => {
  if (dbPath && existsSync(dbPath)) unlinkSync(dbPath);
});

describe('auth tokens', () => {
  it('issueSession returns a 64-hex token whose sha256 row exists in auth_tokens', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { issueSession, verifySessionFromRequest } = await import('../../../server/auth.js');
    const u = createUser({ username: 'm', password: 'pw1234', role: 'merchant' });
    const t = issueSession(u.id);
    expect(typeof t.token).toBe('string');
    expect(t.token.length).toBe(64);
    const tokenHash = createHash('sha256').update(t.token).digest('hex');
    const rows = db.queryAll<{ token_hash: string }>(
      `SELECT token_hash FROM auth_tokens WHERE token_hash = ?`,
      [tokenHash]
    );
    expect(rows.length).toBe(1);

    const req = { headers: { cookie: `statics_token=${t.token}; statics_token_expires=${t.expiresAt}` } } as any;
    const verified = verifySessionFromRequest(req);
    expect(verified?.id).toBe(u.id);

    db.flushNow();
  });

  it('verifySessionFromRequest returns null when cookies are missing', async () => {
    await freshDb();
    const { verifySessionFromRequest } = await import('../../../server/auth.js');
    expect(verifySessionFromRequest({ headers: {} } as any)).toBeNull();
  });

  it('verifySessionFromRequest returns null when the cookie-side expires_at is past', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { issueSession, verifySessionFromRequest } = await import('../../../server/auth.js');
    const u = createUser({ username: 'm2', password: 'pw1234', role: 'merchant' });
    const t = issueSession(u.id);
    const req = { headers: { cookie: `statics_token=${t.token}; statics_token_expires=${Date.now() - 1000}` } } as any;
    expect(verifySessionFromRequest(req)).toBeNull();

    db.flushNow();
  });

  it('verifySessionFromRequest returns null for a disabled user', async () => {
    const db = await freshDb();
    const { createUser, setUserDisabled } = await import('../../../server/users.js');
    const { issueSession, verifySessionFromRequest } = await import('../../../server/auth.js');
    const u = createUser({ username: 'm3', password: 'pw1234', role: 'merchant' });
    const t = issueSession(u.id);
    setUserDisabled(u.id, true);
    const req = { headers: { cookie: `statics_token=${t.token}; statics_token_expires=${t.expiresAt}` } } as any;
    expect(verifySessionFromRequest(req)).toBeNull();

    db.flushNow();
  });

  it('clearSessionForUser removes all tokens so the existing cookie stops working', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { issueSession, clearSessionForUser, verifySessionFromRequest } = await import('../../../server/auth.js');
    const u = createUser({ username: 'm4', password: 'pw1234', role: 'merchant' });
    const t = issueSession(u.id);
    clearSessionForUser(u.id);
    const req = { headers: { cookie: `statics_token=${t.token}; statics_token_expires=${t.expiresAt}` } } as any;
    expect(verifySessionFromRequest(req)).toBeNull();

    db.flushNow();
  });

  it('clearSessionForCurrentToken removes only that token, leaves siblings alone', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { issueSession, clearSessionForCurrentToken, verifySessionFromRequest } = await import('../../../server/auth.js');
    const u = createUser({ username: 'm5', password: 'pw1234', role: 'merchant' });
    const t1 = issueSession(u.id);
    const t2 = issueSession(u.id);
    const req = { headers: { cookie: `statics_token=${t1.token}; statics_token_expires=${t1.expiresAt}` } } as any;
    clearSessionForCurrentToken(req);
    const req2 = { headers: { cookie: `statics_token=${t2.token}; statics_token_expires=${t2.expiresAt}` } } as any;
    expect(verifySessionFromRequest(req2)?.id).toBe(u.id);

    db.flushNow();
  });
});
