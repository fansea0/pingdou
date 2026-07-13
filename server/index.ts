import express from 'express';
import cookieParser from 'cookie-parser';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import {
  trackEvent,
  touchSession,
  querySummary,
} from './db.js';
import {
  getAdminPassword,
  isPasswordConfigured,
  verifyPassword,
  newSessionToken,
  newTokenExpiry,
  isTokenValid,
  extractToken,
  hashIp,
} from './auth.js';

// Priority order (highest first):
//   1. Explicit shell env var (`export STATICS_PASSWORD=xxx`)
//   2. User's shell rc file (~/.bashrc / ~/.zshrc) — most personal/explicit
//   3. Project .env file (least specific, can be committed accidentally)
//
// Non-interactive shells do NOT source ~/.bashrc, so we read it ourselves.
// Only the FIRST source that yields a value wins.

function tryLoadFromShellRc(): string | null {
  const home = homedir();
  const candidates = ['.zshrc', '.bashrc', '.bash_profile', '.profile', '.zshenv'];
  for (const name of candidates) {
    const path = resolve(home, name);
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, 'utf-8');
      const m = text.match(/^\s*(?:export\s+)?STATICS_PASSWORD\s*=\s*["']?([^"'\n#]+)["']?/m);
      if (m && m[1]) {
        const val = m[1].trim();
        if (val.length >= 4) {
          console.log(`[pingdou-server] Loaded STATICS_PASSWORD from ~/${name}`);
          return val;
        }
      }
    } catch {}
  }
  return null;
}

const shellPw = tryLoadFromShellRc();
if (shellPw) {
  // shell rc wins over .env
  process.env.STATICS_PASSWORD = shellPw;
} else {
  // fallback: load .env from CWD
  loadEnv({ quiet: true });
}

async function findFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 20; p++) {
    const ok = await new Promise<boolean>(resolve => {
      const tester = createServer()
        .once('error', () => resolve(false))
        .once('listening', () => tester.close(() => resolve(true)))
        .listen(p, '0.0.0.0');
    });
    if (ok) return p;
  }
  return start;
}

const PORT = Number(process.env.PORT ?? 3000);
const IP_HASH_SALT = process.env.IP_HASH_SALT ?? randomBytes(16).toString('hex');
const COOKIE_NAME = 'statics_token';
const COOKIE_EXPIRES = 'statics_token_expires';

const app = express();

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

app.use((req, _res, next) => {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    'unknown';
  (req as any).clientIp = ip;
  (req as any).ipHash = hashIp(ip, IP_HASH_SALT);
  next();
});

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const t = extractToken(req.headers.cookie);
  if (!t || !isTokenValid(t.token, t.expires_at)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    staticsConfigured: isPasswordConfigured(),
  });
});

app.post('/api/track', (req, res) => {
  const { kind, ref, sid } = req.body ?? {};
  if (
    kind !== 'page-view' &&
    kind !== 'product-click' &&
    kind !== 'image-export'
  ) {
    return res.status(400).json({ error: 'invalid kind' });
  }
  if (kind === 'product-click' && (typeof ref !== 'string' || ref.length === 0)) {
    return res.status(400).json({ error: 'product-click requires ref' });
  }

  try {
    trackEvent({
      kind,
      ref: typeof ref === 'string' ? ref.slice(0, 200) : undefined,
      ipHash: (req as any).ipHash,
      sid: typeof sid === 'string' ? sid.slice(0, 64) : undefined,
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[track]', e);
    return res.status(500).json({ error: 'track failed' });
  }
});

app.post('/api/session/touch', (req, res) => {
  const { sid } = req.body ?? {};
  if (typeof sid !== 'string' || sid.length === 0) {
    return res.status(400).json({ error: 'sid required' });
  }
  try {
    const { day } = touchSession({
      sid: sid.slice(0, 64),
      ipHash: (req as any).ipHash,
    });
    return res.json({ ok: true, day });
  } catch (e) {
    console.error('[session/touch]', e);
    return res.status(500).json({ error: 'session touch failed' });
  }
});

app.post('/api/auth/login', (req, res) => {
  if (!isPasswordConfigured()) {
    return res.status(503).json({ error: 'STATICS_PASSWORD not configured on server' });
  }
  const { password } = req.body ?? {};
  if (typeof password !== 'string' || !verifyPassword(password)) {
    return res.status(401).json({ error: 'invalid password' });
  }
  const token = newSessionToken();
  const expiresAt = newTokenExpiry();
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: expiresAt - Date.now(),
    path: '/',
  });
  res.cookie(COOKIE_EXPIRES, String(expiresAt), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: expiresAt - Date.now(),
    path: '/',
  });
  return res.json({ ok: true, expiresAt });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.clearCookie(COOKIE_EXPIRES, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/statics/summary', requireAuth, (req, res) => {
  const days = Math.max(1, Math.min(90, Number(req.query.days ?? 7)));
  try {
    const summary = querySummary(days);
    return res.json(summary);
  } catch (e) {
    console.error('[statics/summary]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

app.get('/api/statics/status', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

const distDir = resolve(process.cwd(), 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(resolve(distDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      'pingdou server is running. Build the frontend (npm run build) to serve static files. ' +
        'API endpoints under /api/* are available now.'
    );
  });
}

async function start() {
  const requested = PORT;
  const actual = await findFreePort(requested);
  if (actual !== requested) {
    console.warn(`[pingdou-server] Port ${requested} is busy, falling back to ${actual}`);
  }

  app.listen(actual, () => {
    console.log(`[pingdou-server] listening on http://0.0.0.0:${actual}`);
    console.log(`[pingdou-server] App:    http://localhost:${actual}/`);
    console.log(`[pingdou-server] Statics: http://localhost:${actual}/statics`);
    const pw = getAdminPassword();
    if (!pw) {
      console.warn('[pingdou-server] STATICS_PASSWORD env var is NOT SET. /statics will show "统计未启用".');
      console.warn('[pingdou-server] Fix: put STATICS_PASSWORD in .env file or export it before npm run start.');
    } else if (pw.length < 4) {
      console.warn(`[pingdou-server] STATICS_PASSWORD is set but too short (${pw.length} chars). Must be at least 4.`);
    } else {
      console.log(`[pingdou-server] STATICS_PASSWORD configured (${pw.length} chars). /statics login enabled.`);
    }
  });
}

start().catch(err => {
  console.error('[pingdou-server] failed to start:', err);
  process.exit(1);
});