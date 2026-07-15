import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { initDb, querySummary, trackEvent, touchSession, flushNow, queryAll, dayRange } from './db.js';
import { loadProductsCache, getAllProducts, updateProduct, createProduct, deleteProduct, replaceProductImage } from './products.js';
import {
  verifySessionFromRequest, clearAuthCookies, clearSessionForCurrentToken, setAuthCookies,
  clearSessionForUser, issueSession, type AuthedUser,
} from './auth.js';
import {
  getUserByUsername, getUserById, listUsers, createUser, setUserDisabled,
  setUserPassword, setUserMustChangePassword, setUserExpiresAt, countAdmins, seedDefaultAdminIfEmpty,
  checkUserPassword,
} from './users.js';
import { reconcileAssignments, revokeAllForProduct, hasActiveAssignment, getActiveAssignmentsForUser } from './assignments.js';

const PORT = Number(process.env.PORT ?? 3000);

if (process.env.STATICS_PASSWORD) {
  console.warn('[pingdou-server] STATICS_PASSWORD env var is ignored (legacy). Set the root password via /api/admin/users after login.');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('unsupported mime'));
  },
});

export const app = express();

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

app.use((req, _res, next) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  (req as any).clientIp = ip;
  next();
});

interface AuthedRequest extends express.Request { user?: AuthedUser; }

export function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const u = verifySessionFromRequest(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  req.user = u;
  next();
}

function requireAdmin(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  next();
}

function requireProductAccess(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role === 'admin') return next();
  const productId = String(req.params.id);
  if (!hasActiveAssignment(req.user.id, productId)) return res.status(403).json({ error: 'not assigned' });
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, staticsConfigured: true });
});

app.post('/api/track', (req, res) => {
  const { kind, ref, sid } = req.body ?? {};
  if (kind !== 'page-view' && kind !== 'product-click' && kind !== 'image-export') {
    return res.status(400).json({ error: 'invalid kind' });
  }
  try {
    trackEvent({
      kind,
      ref: typeof ref === 'string' ? ref.slice(0, 200) : undefined,
      ipHash: (req as any).clientIp ?? 'unknown',
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
  if (typeof sid !== 'string' || sid.length === 0) return res.status(400).json({ error: 'sid required' });
  try {
    const { day } = touchSession({ sid: sid.slice(0, 64), ipHash: (req as any).clientIp ?? 'unknown' });
    return res.json({ ok: true, day });
  } catch (e) {
    return res.status(500).json({ error: 'session touch failed' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const u = getUserByUsername(username);
  if (!u) return res.status(401).json({ error: 'invalid credentials' });
  if (u.disabled) return res.status(401).json({ error: 'account disabled' });
  if (u.expiresAt != null && Date.now() > u.expiresAt) return res.status(401).json({ error: 'account expired' });
  if (!checkUserPassword(u.id, password)) return res.status(401).json({ error: 'invalid credentials' });
  const issued = issueSession(u.id);
  setAuthCookies(res, issued);
  res.json({
    ok: true,
    role: u.role,
    username: u.username,
    mustChangePassword: !!u.mustChangePassword,
    expiresAt: u.expiresAt,
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionForCurrentToken(req);
  clearAuthCookies(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  res.json({ id: u.id, username: u.username, role: u.role, mustChangePassword: !!u.mustChangePassword, expiresAt: u.expiresAt });
});

app.post('/api/auth/change-password', requireAuth, (req: AuthedRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 4) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  const u = getUserById(req.user!.id)!;
  if (!checkUserPassword(u.id, currentPassword)) return res.status(401).json({ error: 'current password wrong' });
  setUserPassword(u.id, newPassword);
  setUserDisabled(u.id, false);
  setUserMustChangePassword(u.id, false);
  clearSessionForUser(u.id);
  const issued = issueSession(u.id);
  setAuthCookies(res, issued);
  res.json({ ok: true });
});

function buildMerchantSummary(userId: number, days: number) {
  const now = Date.now();
  const fromTs = now - days * 24 * 60 * 60 * 1000;
  const clickTotalRow = queryAll<{ total: number }>(
    `SELECT COUNT(*) AS total FROM events e
       JOIN product_assignments pa ON pa.product_id = e.ref
       WHERE e.kind = 'product-click'
         AND pa.user_id = ?
         AND e.created_at >= pa.assigned_at
         AND (pa.revoked_at IS NULL OR e.created_at < pa.revoked_at)
         AND e.created_at >= ?`,
    [userId, fromTs]
  );
  const pvTotalRow = queryAll<{ total: number }>(
    `SELECT COUNT(*) AS total FROM events WHERE kind = 'page-view' AND created_at >= ?`,
    [fromTs]
  );
  const productCount = getActiveAssignmentsForUser(userId).length;
  const perDayRows = queryAll<{ day: string; total: number }>(
    `SELECT e.day, COUNT(*) AS total FROM events e
       JOIN product_assignments pa ON pa.product_id = e.ref
       WHERE e.kind = 'product-click'
         AND pa.user_id = ?
         AND e.created_at >= pa.assigned_at
         AND (pa.revoked_at IS NULL OR e.created_at < pa.revoked_at)
         AND e.created_at >= ?
       GROUP BY e.day`,
    [userId, fromTs]
  );
  const perDayMap = new Map(perDayRows.map(r => [r.day, r.total]));
  const perDay = dayRange(fromTs, now).map(day => ({ day, myClicks: perDayMap.get(day) ?? 0 }));
  const productBreakdown = queryAll<{ ref: string; total: number }>(
    `SELECT e.ref, COUNT(*) AS total FROM events e
       JOIN product_assignments pa ON pa.product_id = e.ref
       WHERE e.kind = 'product-click'
         AND pa.user_id = ?
         AND e.created_at >= pa.assigned_at
         AND (pa.revoked_at IS NULL OR e.created_at < pa.revoked_at)
         AND e.created_at >= ?
       GROUP BY e.ref
       ORDER BY total DESC`,
    [userId, fromTs]
  );
  return {
    totals: {
      pageView: pvTotalRow[0]?.total ?? 0,
      myClicks: clickTotalRow[0]?.total ?? 0,
      productCount,
    },
    perDay,
    productBreakdown: productBreakdown.map(r => ({ productId: r.ref, total: r.total })),
  };
}

app.get('/api/statics/summary', requireAuth, (req: AuthedRequest, res) => {
  const days = Math.max(1, Math.min(90, Number(req.query.days ?? 7)));
  try {
    if (req.user!.role === 'admin') {
      const summary = querySummary(days);
      return res.json({
        totals: summary.totals,
        perDay: summary.perDay,
        productClicks: summary.productClicks,
      });
    }
    return res.json(buildMerchantSummary(req.user!.id, days));
  } catch (e) {
    console.error('[statics/summary]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

app.get('/api/products', requireAuth, (req: AuthedRequest, res) => {
  const all = getAllProducts();
  if (req.user!.role === 'admin') return res.json(all);
  const assignedIds = new Set(getActiveAssignmentsForUser(req.user!.id).map(a => a.productId));
  res.json(all.filter(p => assignedIds.has(p.id)));
});

app.put('/api/products/:id', requireAuth, requireProductAccess, (req: AuthedRequest, res) => {
  const { name, description, price, url, badge } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (typeof name === 'string') patch.name = name;
  if (typeof description === 'string') patch.description = description;
  if (typeof price === 'number') patch.price = price;
  if (typeof url === 'string') patch.url = url;
  if (badge === null || typeof badge === 'string') patch.badge = badge ?? undefined;
  try {
    return res.json(updateProduct(String(req.params.id), patch));
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'update failed' });
  }
});

app.post('/api/products/:id/image', requireAuth, requireProductAccess, upload.single('file'), (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    return res.json(replaceProductImage(String(req.params.id), req.file.buffer, req.file.mimetype));
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'upload failed' });
  }
});

app.post('/api/products', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  try {
    return res.json(createProduct(req.body ?? {}));
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'create failed' });
  }
});

app.delete('/api/products/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  try {
    deleteProduct(String(req.params.id));
    revokeAllForProduct(String(req.params.id));
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(404).json({ error: e.message ?? 'delete failed' });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const list = listUsers().map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    disabled: !!u.disabled,
    mustChangePassword: !!u.mustChangePassword,
    expiresAt: u.expiresAt,
    createdAt: u.createdAt,
    products: getActiveAssignmentsForUser(u.id).map(a => a.productId),
  }));
  res.json(list);
});

app.post('/api/admin/users', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { username, password, role, productIds = [], expiresAt = null, mustChangePassword = false } = req.body ?? {};
  if (typeof username !== 'string') return res.status(400).json({ error: 'username required' });
  if (typeof password !== 'string' || password.length < 4) return res.status(400).json({ error: 'password too short' });
  if (role !== 'admin' && role !== 'merchant') return res.status(400).json({ error: 'invalid role' });
  const validProductIds = new Set(getAllProducts().map(p => p.id));
  for (const pid of productIds) {
    if (!validProductIds.has(pid)) return res.status(400).json({ error: `unknown product: ${pid}` });
  }
  if (Array.isArray(productIds) && productIds.length > 0 && role !== 'merchant') {
    return res.status(400).json({ error: 'productIds only valid for merchants' });
  }
  try {
    const u = createUser({ username, password, role, expiresAt: expiresAt ?? null, mustChangePassword: !!mustChangePassword });
    if (role === 'merchant' && Array.isArray(productIds) && productIds.length > 0) {
      reconcileAssignments(u.id, productIds);
    }
    return res.json({ id: u.id, username: u.username, role: u.role });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'create failed' });
  }
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const { password, disabled, expiresAt, mustChangePassword, productIds } = req.body ?? {};
  try {
    const target = getUserById(id);
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (target.role === 'admin' && countAdmins() === 1 && disabled === true) {
      return res.status(409).json({ error: 'cannot disable the last admin' });
    }
    if (typeof password === 'string') setUserPassword(id, password);
    if (typeof disabled === 'boolean') setUserDisabled(id, disabled);
    if (typeof mustChangePassword === 'boolean') setUserMustChangePassword(id, mustChangePassword);
    if (expiresAt === null || typeof expiresAt === 'number') setUserExpiresAt(id, expiresAt);
    if (Array.isArray(productIds)) {
      const validProductIds = new Set(getAllProducts().map(p => p.id));
      for (const pid of productIds) {
        if (!validProductIds.has(pid)) return res.status(400).json({ error: `unknown product: ${pid}` });
      }
      reconcileAssignments(id, productIds);
    }
    if (typeof password === 'string' || disabled === true) clearSessionForUser(id);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'patch failed' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { deleteUser } = await import('./users.js');
    deleteUser(id);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(409).json({ error: e.message ?? 'delete failed' });
  }
});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { newPassword } = req.body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < 4) return res.status(400).json({ error: 'password too short' });
  try {
    setUserPassword(id, newPassword);
    clearSessionForUser(id);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'reset failed' });
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
    res.type('text/plain').send('pingdou server is running. Build the frontend (npm run build) to serve static files.');
  });
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

export async function start(): Promise<void> {
  await initDb();
  seedDefaultAdminIfEmpty();
  loadProductsCache();

  const requested = PORT;
  const actual = await findFreePort(requested);
  if (actual !== requested) {
    console.warn(`[pingdou-server] Port ${requested} is busy, falling back to ${actual}`);
  }

  app.listen(actual, () => {
    console.log(`[pingdou-server] listening on http://0.0.0.0:${actual}`);
    console.log(`[pingdou-server] App:    http://localhost:${actual}/`);
    console.log(`[pingdou-server] Statics: http://localhost:${actual}/statics`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch(err => {
    console.error('[pingdou-server] failed to start:', err);
    process.exit(1);
  });
}

void flushNow;
