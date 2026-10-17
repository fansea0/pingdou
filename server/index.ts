import 'dotenv/config';

import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { initDb, querySummary, queryPublicTotals, queryRegions, trackEvent, touchSession, flushNow, queryAll, dayRange, getSetting, listAllSettings, setSetting } from './db.js';
import { resolveRegion, geoStatus } from './geo.js';
import { loadProductsCache, getAllProducts, updateProduct, createProduct, deleteProduct, replaceProductImage, cleanupOrphanImages, reorderProducts } from './products.js';
import { PATHS } from './paths.js';
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
import {
  listPublishedWorks, getPublishedWork, listAllWorks,
  updateWorkMeta, deleteWork,
  normalizePublished,
  addLike, likeStateOf, likeFingerprint,
  createSubmission, attachSubmissionImage,
  approveWork, rejectWork,
  SubmissionInputError, SubmissionQuotaError,
  WorkStateError,
  type UpdateWorkMeta,
} from './works.js';

// 后端固定端口 3000（dev / prod 一致）。可通过 PORT 环境变量覆盖。
// 前端 dev / preview 都走 5173（见 vite.config.ts）；
// 生产部署推荐 nginx 反代把同一域名下的 /api 转发到 3000，避免跨域。
const DEFAULT_PORT = 3000;
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

if (process.env.STATICS_PASSWORD) {
  console.warn('[pingdou-server] STATICS_PASSWORD env var is ignored (legacy). Set the root password via /api/admin/users after login.');
}

/**
 * 启动时校验：PINGDOU_DATA_DIR 必填（由 paths.ts 顶层 throw 兜底）；目录不存在则自动创建。
 */
function assertRuntimePaths(): void {
  // PATHS 已经从 paths.ts 顶层 throw；这里只做目录兜底
  mkdirSync(PATHS.imagesDir, { recursive: true });
  // 作品原图 + 缩略图。driver 的 put() 自己也会建目录，这里建的是 media/ 本身，
  // 让 /media/works/ 兜底路由在「一条作品都没上传过」时也能正常响应。
  mkdirSync(PATHS.mediaDir, { recursive: true });
  // db 文件由 initDb 自己处理（如果 PINGDOU_DATA_DIR 不存在 initDb 会写不到，先建根目录兜底）
  mkdirSync(PATHS.dataDir, { recursive: true });
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('unsupported mime'));
  },
});

function multerErrorPayload(err: any): { status: number; body: { error: string } } | null {
  if (!err) return null;
  // multer 错误都带 code；其他 upload 中间件抛的 Error 不带
  const code = (err as any).code as string | undefined;
  if (code === 'LIMIT_FILE_SIZE') {
    return { status: 413, body: { error: `图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB，请压缩后再上传` } };
  }
  if (code === 'LIMIT_UNEXPECTED_FILE') {
    return { status: 400, body: { error: '上传字段名错误' } };
  }
  if (err.message === 'unsupported mime') {
    return { status: 400, body: { error: '仅支持 jpeg / png / webp 格式' } };
  }
  if (err instanceof multer.MulterError || code) {
    return { status: 400, body: { error: `上传失败：${err.message}` } };
  }
  return null;
}

function handleUpload(fieldName: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    upload.single(fieldName)(req, res, (err: any) => {
      if (!err) return next();
      const payload = multerErrorPayload(err);
      if (payload) return res.status(payload.status).json(payload.body);
      return next(err);
    });
  };
}

/** 两个文件 + 若干文本字段的上传（如作品原图 + 浏览器端生成的缩略图）。 */
function handleUploadFields(specs: { name: string; maxCount: number }[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    upload.fields(specs)(req, res, (err: any) => {
      if (!err) return next();
      const payload = multerErrorPayload(err); // 复用现有错误映射，不新增文案
      if (payload) return res.status(payload.status).json(payload.body);
      return next(err);
    });
  };
}

export const app = express();

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

app.use((req, _res, next) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  (req as any).clientIp = ip;
  next();
});

/**
 * 点赞接口的进程内令牌桶：每 IP 每 1 秒最多 1 次。
 *
 * 为什么光靠主键不够：复合主键挡住了「重复插入」，但挡不住「同一 IP 疯狂 POST
 * 触发的写事务 + COUNT 查询」—— 那些请求照样会打到 DB。这里在 POST handler 的第一行
 * 就掐掉（早于 getPublishedWork 的存在性校验），超了直接 429，一条 SQL 都不发。
 *
 * 已知局限（部署形态相关，勿当 bug 修）：只在单进程内有效。当前是 systemd 单进程
 * 跑一个 node，够用；将来横向扩展成多进程必须换成 Redis 之类的共享存储。
 *
 * 另外注意：令牌桶是**模块级** Map。测试里靠 vi.resetModules() 让 server/index.js
 * 重新求值来清桶，否则用例之间会互相污染（同 IP 上一次的 now 被当成这次的 last）。
 */
const LIKE_RATE_LIMIT_MS = 1000;
const LIKE_BUCKET_SWEEP_THRESHOLD = 4096;
const LIKE_BUCKET_TTL_MS = LIKE_RATE_LIMIT_MS * 10;
const likeBuckets = new Map<string, number>();
/** 上次全量清理的时刻。用来把清理节流成最多每秒一次，见 allowLike。 */
let lastSweepAt = 0;

export function allowLike(ip: string, now: number = Date.now()): boolean {
  // 顺手清理过期条目，防止 Map 无限增长（站主一个人点一天也就几十条，
  // 但恶意 IP 可以用大量伪造地址把 Map 撑大）。
  //
  // 为什么要 lastSweepAt 节流：清理本身是 O(n) 全量遍历，而它在 Map 超过阈值后的
  // **每一次**调用里都会跑。评审实测 size=100000 时平均 222µs/次、20000 时 49µs/次 ——
  // 在一个专门为了「防打爆 DB」而写的闸里内建 CPU 放大是自相矛盾的（打不爆 DB 却打满了
  // CPU）。节流到每 LIKE_RATE_LIMIT_MS 最多一次后，最坏情况的扫描频率被钉死在 1Hz，
  // 成本与桶的大小解耦。
  //
  // 保留 size 阈值而不是「无条件定期扫」：条目少时完全不扫，省掉常态开销。
  // 节流只是把清理推迟 ≤1 秒，条目数在极端情况下最多多涨一秒钟的量，无副作用。
  if (
    likeBuckets.size > LIKE_BUCKET_SWEEP_THRESHOLD &&
    now - lastSweepAt > LIKE_RATE_LIMIT_MS
  ) {
    for (const [k, t] of likeBuckets) {
      if (now - t > LIKE_BUCKET_TTL_MS) likeBuckets.delete(k);
    }
    lastSweepAt = now;
  }
  const last = likeBuckets.get(ip) ?? 0;
  if (now - last < LIKE_RATE_LIMIT_MS) return false;
  likeBuckets.set(ip, now);
  return true;
}

/**
 * 这次请求算不算「我自己」。
 * 主信号 = 后台登录 Cookie：站主登录后在前台调试，一定带着 statics_token。
 * 辅信号 = 站主手动开的指纹（settings.selfFingerprint = 他的 IP）：
 * 退出登录 / 换浏览器 / 手机浏览时仍然认得出来。指纹会因移动网络漂移而漏判，
 * 所以它是补充而不是替代。
 */
function resolveIsSelf(req: express.Request, ip: string): boolean {
  if (verifySessionFromRequest(req)) return true;
  const fingerprint = getSetting('selfFingerprint')?.value ?? '';
  return fingerprint.length > 0 && fingerprint === ip;
}

interface AuthedRequest extends express.Request { user?: AuthedUser; }

interface SiteConfig {
  showProducts: boolean;
}

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
  const productId = Number(req.params.id);
  if (!hasActiveAssignment(req.user.id, productId)) return res.status(403).json({ error: 'not assigned' });
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.post('/api/track', (req, res) => {
  const { kind, ref, sid } = req.body ?? {};
  if (kind !== 'page-view' && kind !== 'product-click' && kind !== 'image-export') {
    return res.status(400).json({ error: 'invalid kind' });
  }
  try {
    const ip = (req as any).clientIp ?? 'unknown';
    const region = resolveRegion(ip, req.headers as Record<string, unknown>);
    trackEvent({
      kind,
      ref: typeof ref === 'string' ? ref.slice(0, 200) : undefined,
      ipHash: ip,
      sid: typeof sid === 'string' ? sid.slice(0, 64) : undefined,
      province: region.province,
      city: region.city,
      isSelf: resolveIsSelf(req, ip),
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
    const ip = (req as any).clientIp ?? 'unknown';
    const region = resolveRegion(ip, req.headers as Record<string, unknown>);
    const { day } = touchSession({
      sid: sid.slice(0, 64),
      ipHash: ip,
      province: region.province,
      city: region.city,
      isSelf: resolveIsSelf(req, ip),
    });
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

app.get('/api/statics/public', (_req, res) => {
  try {
    const totals = queryPublicTotals();
    return res.json({ pv: totals.pageView, exports: totals.imageExport });
  } catch (e) {
    console.error('[statics/public]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

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

app.get('/api/statics/regions', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const days = Math.max(1, Math.min(90, Number(req.query.days ?? 30)));
  try {
    const regions = queryRegions(days);
    return res.json({
      days,
      ...regions,
      geo: geoStatus(),
      selfFingerprintEnabled: (getSetting('selfFingerprint')?.value ?? '').length > 0,
    });
  } catch (e) {
    console.error('[statics/regions]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

/**
 * 「标记我的访问」开关。IP 由后端从当前请求取，前端永远碰不到也看不到，
 * 避免把 IP 明文在浏览器里来回传。关闭时写空串（而不是删 key），
 * 这样 settings 表里能看出「曾经用过、现在关了」。
 */
app.put('/api/admin/self-fingerprint', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
  const ip = (req as any).clientIp ?? 'unknown';
  const value = enabled ? ip : '';
  const u = getUserById(req.user!.id);
  try {
    const setting = setSetting('selfFingerprint', value, u?.username ?? '');
    return res.json({ ok: true, enabled: value.length > 0, setting });
  } catch (e) {
    console.error('[admin/self-fingerprint]', e);
    return res.status(500).json({ error: 'update failed' });
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
    return res.json(updateProduct(Number(req.params.id), patch));
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'update failed' });
  }
});

app.post('/api/products/:id/image', requireAuth, requireProductAccess, handleUpload('file'), (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    return res.json(replaceProductImage(Number(req.params.id), req.file.buffer, req.file.mimetype));
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
    const id = Number(req.params.id);
    deleteProduct(id);
    revokeAllForProduct(id);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(404).json({ error: e.message ?? 'delete failed' });
  }
});

// dev-only 兜底：把 /products/<id>-<hex>.<ext> 静态 serve 给前端。
// 生产部署走 nginx `location /products/ { alias <PINGDOU_DATA_DIR>/images/; }` 直接读盘，
// 性能更高；这条路由仅在 vite dev/preview 反代场景下生效。
const PRODUCT_IMAGE_FILENAME_RE = /^[0-9]+-[a-z0-9]+\.(jpg|jpeg|png|webp)$/i;
app.get('/products/:filename', (req, res) => {
  const filename = String(req.params.filename ?? '');
  if (!PRODUCT_IMAGE_FILENAME_RE.test(filename)) {
    return res.status(400).json({ error: 'invalid filename' });
  }
  const fullPath = `${PATHS.imagesDir}/${filename}`;
  res.sendFile(fullPath, (err) => {
    if (!err) return;
    if (err && (err as any).code === 'ENOENT') {
      return res.status(404).json({ error: 'not found' });
    }
    console.error('[products/:filename] sendFile failed', err);
    if (!res.headersSent) res.status(500).json({ error: 'serve failed' });
  });
});

app.get('/api/public/products', (_req, res) => {
  try {
    return res.json(getAllProducts());
  } catch (e) {
    console.error('[public/products]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

// 公开作品列表：只走 listPublishedWorks（草稿在数据层就被滤掉），不区分「不存在」
// 与「未上架」—— 对外只有一种形状。
app.get('/api/public/works', (req, res) => {
  try {
    // `?limit=`（空串）也要走默认值，?? 挡不住空串。
    // 再收一道 NaN：`?limit=abc` 会得到 NaN 并落进数据层那个陈旧的 `: 20` 兜底，
    // 于是新的「默认 10」口径被 `?limit=abc` 绕过（评审实测返回 20 条）。这里收口，
    // 非法值一律当「没传」，语义比数据层的兜底更明确，也不必改 works.ts。
    const rawLimit = Number(req.query.limit || 10);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 10;
    const offset = Number(req.query.offset ?? 0);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const sort = req.query.sort === 'hot' ? 'hot' : 'latest'; // 白名单，非法值回落 latest
    return res.json(listPublishedWorks({ limit, offset, q, sort }));
  } catch (e) {
    console.error('[public/works]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

app.get('/api/public/works/:id', (req, res) => {
  try {
    // 非数字 id → NaN → getPublishedWork 直接 null → 404（不会 500）
    const work = getPublishedWork(Number(req.params.id));
    if (!work) return res.status(404).json({ error: 'not found' });
    return res.json(work);
  } catch (e) {
    console.error('[public/works/:id]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

/** 投稿成品图 + 浏览器生成的缩略图。缩略图的文件名必须以 .webp 结尾，
 *  服务端按扩展名校验 mime。
 *
 *  声明在使用它的 app.post 之前而不是放到文件末尾：const 走 TDZ，被求值到时
 *  会直接 ReferenceError（首次跑用例实测）。
 */
const SUBMISSION_IMAGE_FIELDS = [
  { name: 'image', maxCount: 1 },
  { name: 'thumb', maxCount: 1 },
];

/**
 * 投稿第一步：占一个 id。
 *
 * 配额闸不是「先于一切」的：createSubmission 内部自己按「校验 → 占配额 → 插入」
 * 的顺序走（理由见 server/works.ts 的注释）。这里只负责把它的两个错误类型翻译
 * 成状态码。
 */
app.post('/api/public/works', (req, res) => {
  try {
    const created = createSubmission(req.body, {
      ip: (req as any).clientIp as string,
      userAgent: String(req.headers['user-agent'] ?? ''),
    });
    return res.status(201).json(created);
  } catch (err) {
    if (err instanceof SubmissionQuotaError) return res.status(429).json({ error: err.message });
    if (err instanceof SubmissionInputError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/**
 * extFor 抛的是**裸 Error**（`unsupported image mime type`），不是
 * SubmissionInputError，attachSubmissionImage 里其余拒绝都是 400 类，唯独这条会在
 * 路由层落进「既不是配额也不是输入错」的分支 → 500。投稿是**匿名公网入口**，
 * 让用户传错格式换来一个 500 既误导又掩盖真实原因。
 *
 * 保留正则兜底而不是在 extFor 源头改错误类型，是一次明确的取舍：源头改只剩
 * attachSubmissionImage 一个调用方要跟着改（后台上传通道已删），成本已降到最低，
 * 改与不改都属于本文件之外的决定，先不夹带。
 *
 * **所以在公网入口按消息特征兜一层时，翻译范围必须严格限制在「不支持的 mime」
 * 这一种**，不做「未知错误一律 400」—— 那样会把真的存储故障也报成 400，
 * 等于把故障藏起来。
 */
export function isUnsupportedMimeError(err: unknown): boolean {
  return err instanceof Error && /unsupported (?:image|thumb) mime type/.test(err.message);
}

/**
 * 投稿第二步：把带二维码的成品图挂上去。
 *
 * 必须带 uploadToken —— id 是可猜的自增整数，只靠 id 的话任何人都能把图挂到
 * 别人的待审记录上（见 attachSubmissionImage 的注释）。
 */
app.post('/api/public/works/:id/image', handleUploadFields(SUBMISSION_IMAGE_FIELDS), async (req, res) => {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const image = files.image?.[0];
  if (!image) return res.status(400).json({ error: '缺少图片文件' });
  const token = typeof req.body?.uploadToken === 'string' ? req.body.uploadToken : '';
  const id = Number(req.params.id);
  try {
    const detail = await attachSubmissionImage(id, token, {
      image: { body: image.buffer, mime: image.mimetype },
      thumb: files.thumb?.[0]
        ? { body: files.thumb[0].buffer, mime: files.thumb[0].mimetype }
        : undefined,
      width: req.body?.width,
      height: req.body?.height,
    });
    return res.json({ ok: true, id: detail.id });
  } catch (err) {
    if (err instanceof SubmissionInputError) {
      // 「投稿不存在」是 404，其余（令牌错 / 已传过 / 已处理）是 400。
      // 区分开不是为了泄露信息 —— 攻击者本来就能用 id 探测存在性，
      // 而拿到一个明确 404 能帮正常用户立刻发现「链接过期了，重新投稿」。
      const isMissing = err.message === '投稿不存在';
      return res.status(isMissing ? 404 : 400).json({ error: err.message });
    }
    if (isUnsupportedMimeError(err)) {
      return res.status(400).json({ error: (err as Error).message });
    }
    throw err;
  }
});

/**
 * 点赞状态查询。公开、无需登录 —— 与公开列表同一性质。
 * liked 需要回传 IP 才能判断，所以 POST 与 GET 共用同一个 likeStateOf。
 *
 * 注册顺序：与上面的 `app.get('/api/public/works/:id')` 先后无所谓 —— express
 * 按整段路径匹配，`:id` 只吃一段，`/:id` 匹配不到 `/:id/like`（已实测两种顺序
 * 行为一致）。放在 `:id` 之后只是为了阅读时先详情后子资源。
 */
app.get('/api/public/works/:id/like', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!getPublishedWork(id)) return res.status(404).json({ error: 'not found' });
    const ip = (req as any).clientIp ?? 'unknown';
    // UA 是指纹的必需输入之一：少了它，同 IP 换浏览器会被算成同一个人，
    // 而多人共用一个出口 IP（公司/学校/运营商 NAT）时只有第一个能赞。详见
    // works.ts 的 likeFingerprint 注释。两条 like 路由都必须传，口径才一致。
    const ua = String(req.headers['user-agent'] ?? '');
    return res.json(likeStateOf(id, likeFingerprint(ip, ua, id)));
  } catch (e) {
    console.error('[public/works/:id/like]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

/**
 * 点赞。公开、无需登录。
 *
 * 语义提醒（影响后续 UI 文案）：计数是「次」不是「人」—— 同一 IP 次日可以再给同一张
 * 图点赞，计数累加；且不支持取消。前端文案必须写「N 次点赞」而不是「N 人喜欢」。
 *
 * 三道闸的分工：复合主键挡重复插入、令牌桶挡高频 POST（超限不碰 DB）、
 * express.json({limit:'64kb'}) 挡超大 body。
 */
app.post('/api/public/works/:id/like', (req, res) => {
  try {
    const ip = (req as any).clientIp ?? 'unknown';

    // 令牌桶必须排在 404 检查**之前**：排在后面时，「不存在/草稿 id」这条路径会先打
    // 一条 getPublishedWork 的 SQL 才被 404 挡掉，于是 (a) 429 路径并非零 SQL，
    // (b) 同一 IP 连打不存在的 id 可以无限次穿透到 DB —— 那是一条真正可被利用的刷库
    // 路径（评审实测：12 次全部 404、零 429）。放前面后超限请求一条 SQL 都不发。
    //
    // 代价（已知且接受）：无效 id 的请求会消耗**调用方自己**的令牌额度（自伤），
    // 但不会影响别人 —— 桶按 IP 分开。被误伤的表现是「点错了，第二次直接 429」，
    // 1 秒后自动恢复，远好于被刷库。
    if (!allowLike(ip)) {
      // 限流时不碰 DB —— 这正是这道闸的意义
      return res.status(429).json({ error: 'too many likes, try again later' });
    }

    // 404 仍然要判：令牌桶只管频率、不管资源是否合法。addLike 对不存在的 id 不抛错，
    // 只返回 {likes:0, liked:false}，那样草稿点赞会静默变成 200 + 0 赞，而不是 404。
    const id = Number(req.params.id);
    if (!getPublishedWork(id)) return res.status(404).json({ error: 'not found' });

    // addLike 幂等：同一 fingerprint（IP+UA+作品+日期）当天重复点赞 alreadyLiked=false 且计数不变
    const ua = String(req.headers['user-agent'] ?? '');
    const next = addLike(id, likeFingerprint(ip, ua, id));
    return res.json({ ok: true, likes: next.likes, alreadyLiked: next.liked });
  } catch (e) {
    console.error('[public/works/:id/like POST]', e);
    return res.status(500).json({ error: 'like failed' });
  }
});

// dev-only 兜底：把 /media/works/<file> 直读盘。生产走 nginx location 直读，性能更高。
// 文件名走严格白名单，非法名字一律 400 —— 不落到 sendFile 上给路径穿越留机会。
//
// 扩展名必须与 works.ts 的 EXT_BY_MIME 覆盖范围一致：jpg / webp / png 三种 mime
// 都会被 multer 的 fileFilter 放行，works.ts 按原始 mime 派生扩展名原样落盘。
// 少写一种，那些作品就「存得上、URL 永久 400」。白名单拦的是路径穿越
// （必须是 16 位 hex + 固定扩展名），不是限制扩展名种类。
const MEDIA_FILENAME_RE = /^[0-9a-f]{16}\.(png|jpg|webp)$/;
const MEDIA_THUMB_RE = /^[0-9a-f]{16}-t\.webp$/;
app.get('/media/works/:filename', (req, res) => {
  const filename = String(req.params.filename ?? '');
  if (!MEDIA_FILENAME_RE.test(filename) && !MEDIA_THUMB_RE.test(filename)) {
    return res.status(400).json({ error: 'invalid filename' });
  }
  const fullPath = join(PATHS.mediaDir, 'works', filename);
  res.sendFile(fullPath, (err) => {
    if (!err) return;
    if ((err as any).code === 'ENOENT') return res.status(404).json({ error: 'not found' });
    console.error('[media/works/:filename] sendFile failed', err);
    if (!res.headersSent) res.status(500).json({ error: 'serve failed' });
  });
});

// admin 作品接口。列表走 listAllWorks（含草稿），这条路径必须 requireAuth + requireAdmin，
// 绝不能和 /api/public/works 共用数据源。
//
// 后台上传通道（POST /api/admin/works 与 POST /api/admin/works/:id/image）已随
// createWork / replaceWorkImage 一起删除：进货入口只剩投稿，留着它们意味着
// multer 双文件字段解析、缩略图 mime 校验、孤儿文件回收那一整套还要维护还要测，
// 却没有任何调用方。将来若要恢复后台直传，从 git 历史取回即可。

// 后台列表走 toAdminDetail：比公开 detail 多一个 published 布尔字段，
// 后台靠它显示上下架开关。公开接口 /api/public/* 刻意不带该字段。
app.get('/api/admin/works', requireAuth, requireAdmin, (req, res) => {
  try {
    const raw = String(req.query.status ?? '').trim();
    // 白名单：非法值回落「全部」。不因为手改一个 query 就整页报错。
    const status =
      raw === 'pending' || raw === 'approved' || raw === 'rejected' ? raw : undefined;
    return res.json(listAllWorks(status ? { status } : undefined));
  } catch (e) {
    console.error('[admin/works]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

app.put('/api/admin/works/:id', requireAuth, requireAdmin, async (req, res) => {
  const { title, description, published } = req.body ?? {};
  const patch: UpdateWorkMeta = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof description === 'string') patch.description = description;
  // null 也当成「客户端明确传了这个字段」，不走 fallback：把 null 当成「没传」会
  // 用 fallback=true 把草稿静默上架。fail-closed 更安全，非法值一律不动 published。
  if (published !== undefined && published !== null) patch.published = normalizePublished(published, true);
  try {
    return res.json(await updateWorkMeta(Number(req.params.id), patch));
  } catch (e: any) {
    // 「这件作品存在，但当前状态不允许这次改动」是 400，「找不到这件作品」才是 404。
    // 以前这里一律 404，站主拿到 404 会以为作品被删了，排查方向整个是错的。
    // 其余异常（找不到 / id 非法）**维持 404 不变** —— 别把语义搅浑：
    // 404 在这条路由上仍然只表示「没有这件作品」。
    if (e instanceof WorkStateError) return res.status(400).json({ error: e.message ?? 'update failed' });
    return res.status(404).json({ error: e.message ?? 'update failed' });
  }
});

app.delete('/api/admin/works/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await deleteWork(Number(req.params.id));
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(404).json({ error: e.message ?? 'delete failed' });
  }
});

app.post('/api/admin/works/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(approveWork(Number(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/admin/works/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await rejectWork(Number(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/admin/products/reorder', requireAuth, requireAdmin, (req, res) => {
  const { orderedIds } = req.body ?? {};
  if (!Array.isArray(orderedIds) || !orderedIds.every((x: unknown) => typeof x === 'number')) {
    return res.status(400).json({ error: 'orderedIds must be number[]' });
  }
  try {
    const next = reorderProducts(orderedIds);
    return res.json({ ok: true, products: next });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'reorder failed' });
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

const ALLOWED_SETTING_KEYS = new Set(['showProducts', 'selfFingerprint']);
const DEFAULT_SITE_CONFIG: SiteConfig = { showProducts: true };

function parseBoolSetting(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function readPublicSiteConfig(): SiteConfig {
  const row = getSetting('showProducts');
  return {
    showProducts: parseBoolSetting(row?.value, DEFAULT_SITE_CONFIG.showProducts),
  };
}

app.get('/api/config', (_req, res) => {
  try {
    return res.json(readPublicSiteConfig());
  } catch (e) {
    console.error('[config] read failed', e);
    return res.status(500).json({ error: 'config read failed' });
  }
});

app.get('/api/admin/settings', requireAuth, requireAdmin, (_req, res) => {
  try {
    return res.json({ settings: listAllSettings() });
  } catch (e) {
    console.error('[admin/settings] list failed', e);
    return res.status(500).json({ error: 'settings list failed' });
  }
});

app.put('/api/admin/settings', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { key, value } = req.body ?? {};
  if (typeof key !== 'string' || typeof value !== 'string') {
    return res.status(400).json({ error: 'key & value required' });
  }
  if (!ALLOWED_SETTING_KEYS.has(key)) {
    return res.status(400).json({ error: 'unknown setting key' });
  }
  const u = getUserById(req.user!.id);
  const updatedBy = u?.username ?? '';
  try {
    const next = setSetting(key, value, updatedBy);
    console.log(`[admin/settings] updated key=${key} value=${value} by=${updatedBy}`);
    return res.json({ ok: true, setting: next });
  } catch (e) {
    console.error('[admin/settings] update failed', e);
    return res.status(500).json({ error: 'settings update failed' });
  }
});

// 仅 API 进程：前端静态资源由 nginx / `vite preview` 独立托管（端口 5173）。
// 健康检查根路径，方便部署时做存活探测。
app.get('/', (_req, res) => {
  res.type('text/plain').send(`pingdou api is running on port ${PORT}`);
});

// 全局兜底：保证任何未捕获错误都返回 JSON，而不是 HTML 错误页
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', err);
  if (res.headersSent) return;
  // express.json 在 body 超 limit 时抛 entity.too.large，type=entity，status=413
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: '请求体过大，请检查上传内容' });
  }
  res.status(500).json({ error: err?.message ?? 'internal error' });
});

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
  assertRuntimePaths();
  await initDb();
  seedDefaultAdminIfEmpty();
  loadProductsCache();
  cleanupOrphanImages();

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
