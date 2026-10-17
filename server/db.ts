import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PATHS } from './paths.js';

const DB_PATH = PATHS.dbPath;
const WASM_PATH = resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let dirty = false;
let saveTimer: NodeJS.Timeout | null = null;

const SAVE_DEBOUNCE_MS = 500;

export async function initDb(): Promise<void> {
  SQL = await initSqlJs({
    locateFile: (file: string) => {
      if (file.endsWith('.wasm')) return WASM_PATH;
      return resolve(dirname(WASM_PATH), file);
    },
  });

  if (existsSync(DB_PATH)) {
    const buf = readFileSync(DB_PATH);
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    db = new SQL.Database();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref TEXT,
      created_at INTEGER NOT NULL,
      day TEXT NOT NULL,
      ip_hash TEXT,
      province TEXT,
      city TEXT,
      is_self INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_day ON events(day);
    CREATE INDEX IF NOT EXISTS idx_events_ref ON events(ref);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      day TEXT NOT NULL,
      province TEXT,
      city TEXT,
      is_self INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','merchant')),
      disabled INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_assignment
      ON product_assignments(product_id) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_assignments_user_active
      ON product_assignments(user_id, revoked_at);

    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL DEFAULT '',
      image       TEXT    NOT NULL DEFAULT '',
      price       INTEGER NOT NULL DEFAULT 0,
      description TEXT    NOT NULL DEFAULT '',
      url         TEXT    NOT NULL DEFAULT '',
      badge       TEXT,
      "order"     INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      CHECK ("order" >= 1)
    );
    CREATE INDEX IF NOT EXISTS idx_products_order ON products("order");

    -- 作品库（2026-10-16）。导出图纸右下角二维码指向 /works，扫码用户在这里找图。
    -- 只存存储层 key，不存 URL：对外地址一律由 StorageDriver.publicUrl() 现算，
    -- 这样换存储实现时老数据一行都不用洗。
    -- 刻意不加 order / downloads / slug，理由见 spec 3.6。
    CREATE TABLE IF NOT EXISTS works (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL DEFAULT '',
      description TEXT    NOT NULL DEFAULT '',
      image_key   TEXT    NOT NULL,
      thumb_key   TEXT    NOT NULL DEFAULT '',
      width       INTEGER NOT NULL DEFAULT 0,
      height      INTEGER NOT NULL DEFAULT 0,
      bytes       INTEGER NOT NULL DEFAULT 0,
      published   INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      -- 2026-10-17：从 work_likes 表聚合改为**直接存计数**。原来赞数只增不减地堆在
      -- 独立表里，列表查询每次都要对全表做一次 GROUP BY 聚合，那才是「存库查询压力大」
      -- 的真正来源；改成整数列后列表直读该列 —— 零聚合、表零增长。
      --
      -- 「同一 IP 每天一次」的去重不再落库，改为进程内 Set（见 works.ts 的
      -- likeFingerprint / 每日轮转）。代价是**重启后当天可以再赞**，用户已明确接受。
      -- 计数是「次数」不是「人数」：同一 IP 次日可再点赞，计数会累加。
      likes       INTEGER NOT NULL DEFAULT 0,
      -- 2026-10-17：用户投稿 + 后台审核。作品来源从后台上传整个切换成用户投稿，
      -- 于是同一张表要同时表达「审核到哪一步」和「图纸本身长什么样」。
      --
      -- status 默认 pending 是刻意的失败安全：任何漏写 status 的行（手写 SQL、
      -- 将来新增的写路径忘了带这个字段）落成「不公开」，而不是直接对外可见。
      status           TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
      -- 图纸格数（如 87 × 62）。存两个整数而不是 "1:1.4" 字符串：比例由展示层现算，
      -- 改展示精度不用洗历史数据；而字符串还要防有人传 "1:999" 这种离谱值。
      board_w          INTEGER NOT NULL DEFAULT 0,
      board_h          INTEGER NOT NULL DEFAULT 0,
      -- 实际画出的豆子数 / 用到的色号种数。审核时站主要靠这两项判断值不值得过。
      bean_count       INTEGER NOT NULL DEFAULT 0,
      color_count      INTEGER NOT NULL DEFAULT 0,
      -- 预估装配工时，存**分钟数**不存文案：以后改 formatAssemblyHours 的措辞，
      -- 历史数据一行都不用动。
      estimate_minutes INTEGER NOT NULL DEFAULT 0,
      -- 第二步上传图片用的一次性令牌（spec §5.2）。id 是可猜的自增整数，
      -- 只靠 id 校验的话任何人都能把图挂到别人的待审记录上。图写入后清空成 ''。
      upload_token     TEXT    NOT NULL DEFAULT '',
      CHECK (published IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS idx_works_published_created
      ON works(published, created_at DESC);

    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL DEFAULT ''
    );
  `);

  // 来源地 / 自我访问区分（2026-10-14）。新库由上面的 CREATE TABLE 直接建好；
  // 老库缺列，走幂等 ALTER 纯追加升级，老行新列为 NULL / 0，老行为完全不变。
  // SQLite 不支持 ADD COLUMN IF NOT EXISTS，所以先查 PRAGMA 再决定要不要 ALTER。
  ensureColumn('events', 'province', 'TEXT');
  ensureColumn('events', 'city', 'TEXT');
  ensureColumn('events', 'is_self', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('sessions', 'province', 'TEXT');
  ensureColumn('sessions', 'city', 'TEXT');
  ensureColumn('sessions', 'is_self', 'INTEGER NOT NULL DEFAULT 0');
  ensureIndex('idx_events_province', 'events(province, created_at)');

  // 点赞模型迁移：work_likes 表 → works.likes 计数列。**顺序不可颠倒。**
  //
  // 加列 → 回填 → 删表。回填必须在删表之前：work_likes 一旦 DROP，历史赞数就再也
  // 拿不回来了，而老库的 likes 列此刻全是默认 0 —— 表现就是「升级后所有历史赞数归零」，
  // 且没有任何报错。这类静默的数据丢失比迁移失败可怕得多。
  ensureColumn('works', 'likes', 'INTEGER NOT NULL DEFAULT 0');
  // hot 排序走这个索引。没有它 ORDER BY likes DESC 会退化成扫表 + 临时排序，
  // 而这次改造的全部意义就是让列表查询变便宜，不能在这一步把收益吐回去。
  //
  // **必须排在 ensureColumn 之后**：老库的 works 表还没有 likes 列，
  // 提前建索引会抛 "no such column: likes" 直接让 initDb 起不来。
  ensureIndex('idx_works_published_likes', 'works(published, likes DESC, created_at DESC, id DESC)');
  migrateWorkLikesToCountColumn();

  // 用户投稿 + 审核（2026-10-17）。七列全是纯追加，老行落成默认值。
  //
  // 刻意**不**回填 status='approved'：那会把「未过审」和「已过审」在数据上混成同一个
  // 值，而这次改动的全部意义就是这两者分开。存量数据的归宿是被清库脚本删掉，不是
  // 被洗成 approved。在脚本跑之前它们被公开查询的 `AND status='approved'` 全部挡住
  // —— 即「部署后图库显示为空」是预期行为，不是故障（spec §9）。
  ensureColumn('works', 'status', "TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))");
  ensureColumn('works', 'board_w', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('works', 'board_h', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('works', 'bean_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('works', 'color_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('works', 'estimate_minutes', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('works', 'upload_token', "TEXT NOT NULL DEFAULT ''");
  // 必须排在 ensureColumn('works','status',...) 之后：老库还没有 status 列，
  // 提前建索引会抛 "no such column: status"，initDb 直接起不来。
  ensureIndex('idx_works_status_created', 'works(status, created_at DESC)');

  runStmt(
    `INSERT OR IGNORE INTO settings(key, value, updated_at, updated_by) VALUES(?, ?, ?, ?)`,
    ['showProducts', 'true', Date.now(), ''],
  );

  flushNow();

  loadAllSettings();

  process.on('beforeExit', () => {
    flushNow();
  });
  process.on('SIGINT', () => {
    flushNow();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    flushNow();
    process.exit(0);
  });
}

function requireDb(): Database {
  if (!db) throw new Error('database not initialized; call initDb() first');
  return db;
}

/** 幂等加列：列已存在就什么都不做，保证老库 / 新库走同一条路径 */
function ensureColumn(table: string, column: string, type: string): void {
  const database = requireDb();
  const rows = database.exec(`PRAGMA table_info(${table})`);
  const existing = rows.length > 0
    ? (rows[0].values as unknown[][]).map(v => String(v[1]))
    : [];
  if (existing.includes(column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  console.log(`[db] 升级 schema: ${table}.${column} ${type}`);
}

/** 幂等建索引 */
function ensureIndex(name: string, target: string): void {
  requireDb().exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${target}`);
}

function tableExists(table: string): boolean {
  return queryAll<{ n: number }>(
    `SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [table]
  ).length > 0;
}

/**
 * work_likes 表 → works.likes 计数列。**幂等**：表没了就直接返回，
 * 所以新库、老库、以及已迁移过的库走同一条路径。
 *
 * 回填用「累加」而不是「赋值」：ensureColumn 刚把老行的 likes 补成默认 0，
 * 累加与赋值结果相同，但累加语义正确 —— 万一将来有别的路径先写过 likes，
 * 赋值会把那些值抹掉。
 *
 * 关联条件是 `work_likes.work_id = works.id`：没有外键约束（works 表本身也没有外键），
 * 真有孤儿行时 COUNT 为 0，不影响任何真实作品。works.id 是 AUTOINCREMENT，
 * 行号永不复用，孤儿行也不会串号到后来的作品上。
 */
function migrateWorkLikesToCountColumn(): void {
  if (!tableExists('work_likes')) return;
  const database = requireDb();
  database.exec(
    `UPDATE works
        SET likes = likes + (SELECT COUNT(*) FROM work_likes WHERE work_id = works.id)`
  );
  database.exec(`DROP TABLE work_likes`);
  // exec() 不标脏。迁移完不显式标脏的话，这次改写只会留在内存里，重启即回滚成
  // 「有 work_likes 表、works.likes 全 0」的半迁移状态 —— 而下次启动因为表还在
  // 又会重新回填一遍，看起来「有时生效有时不生效」，极难排查。
  markDirty();
  console.log('[db] 迁移：work_likes 赞数已累加进 works.likes，该表已删除');
}

function markDirty(): void {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushNow();
  }, SAVE_DEBOUNCE_MS);
}

export function flushNow(): void {
  if (!db || !dirty) return;
  try {
    const data = db.export();
    writeFileSync(DB_PATH, Buffer.from(data));
    dirty = false;
  } catch (e) {
    console.error('[db] flush failed:', e);
  }
}

export function runStmt(sql: string, params: (number | string | null)[]): void {
  const stmt = requireDb().prepare(sql);
  try {
    stmt.run(params);
  } finally {
    stmt.free();
  }
  markDirty();
}

export function queryAll<T = Record<string, unknown>>(
  sql: string,
  params: (number | string | null)[] = [],
): T[] {
  const stmt = requireDb().prepare(sql);
  const rows: T[] = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
  } finally {
    stmt.free();
  }
  return rows;
}

/**
 * 写操作，同时要拿回 RETURNING 行的场景（如点赞的 INSERT OR IGNORE）。
 *
 * 为什么不能直接用 queryAll：queryAll 是纯读接口，不调 markDirty，写进去的行永远
 * 不会被 flushNow 落盘 —— 只要站点没有别的写操作，重启后这行就没了。
 * 为什么不能直接用 runStmt：它返回 void，拿不到「这次到底插没插进去」。
 */
export function execReturning<T = Record<string, unknown>>(
  sql: string,
  params: (number | string | null)[] = [],
): T[] {
  const rows = queryAll<T>(sql, params);
  markDirty();
  return rows;
}

export function runInTransaction<T>(fn: () => T): T {
  const database = requireDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    try { database.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

export function trackEvent(opts: {
  kind: 'page-view' | 'product-click' | 'image-export';
  ref?: string;
  ipHash: string;
  sid?: string;
  province?: string | null;
  city?: string | null;
  /** 1 = 后台登录账号或站主指纹发起的访问；0 = 匿名外部访客 */
  isSelf?: boolean;
}): void {
  const now = Date.now();
  const day = isoDay(now);
  const isSelf = opts.isSelf ? 1 : 0;
  runStmt(
    `INSERT INTO events (kind, ref, created_at, day, ip_hash, province, city, is_self)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [opts.kind, opts.ref ?? null, now, day, opts.ipHash,
      opts.province ?? null, opts.city ?? null, isSelf],
  );
  if (opts.sid) {
    upsertSession(opts.sid, opts.ipHash, now, opts.province ?? null, opts.city ?? null, isSelf);
  }
}

export function touchSession(opts: {
  sid: string;
  ipHash: string;
  province?: string | null;
  city?: string | null;
  isSelf?: boolean;
}): { day: string } {
  const now = Date.now();
  const day = isoDay(now);
  upsertSession(
    opts.sid,
    opts.ipHash,
    now,
    opts.province ?? null,
    opts.city ?? null,
    opts.isSelf ? 1 : 0,
  );
  return { day };
}

/**
 * session 只保留「最近一次」的行，所以归属和 is_self 跟着最新一次覆盖写。
 * 这样 UV 口径（COUNT(DISTINCT ip_hash)）完全不受影响。
 */
function upsertSession(
  sid: string,
  ipHash: string,
  now: number,
  province: string | null,
  city: string | null,
  isSelf: number,
): void {
  runStmt(
    `INSERT INTO sessions (id, ip_hash, created_at, last_seen_at, day, province, city, is_self)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       day = excluded.day,
       province = excluded.province,
       city = excluded.city,
       is_self = excluded.is_self`,
    [sid, ipHash, now, now, isoDay(now), province, city, isSelf],
  );
}

export function isoDay(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dayRange(fromTs: number, toTs: number): string[] {
  const days: string[] = [];
  const start = new Date(fromTs);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(toTs);
  end.setUTCHours(0, 0, 0, 0);
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(isoDay(d.getTime()));
  }
  return days;
}

export interface BucketSummary {
  day: string;
  total: number;
}

export interface ProductClickSummary {
  ref: string;
  total: number;
}

export interface SummaryResult {
  totals: { pageView: number; productClick: number; imageExport: number; uv: number };
  perDay: BucketSummary[];
  productClicks: ProductClickSummary[];
}

export function querySummary(days: number): SummaryResult {
  const now = Date.now();
  const fromTs = now - days * 24 * 60 * 60 * 1000;

  const perDayRows = queryAll<{ day: string; total: number }>(
    `SELECT day, COUNT(*) AS total
     FROM events
     WHERE created_at >= ?
     GROUP BY day
     ORDER BY day ASC`,
    [fromTs],
  );
  const perDayMap = new Map<string, number>();
  for (const row of perDayRows) perDayMap.set(row.day, row.total);
  const allDays = dayRange(fromTs, now);
  const perDay: BucketSummary[] = allDays.map(day => ({
    day,
    total: perDayMap.get(day) ?? 0,
  }));

  const totalRows = queryAll<{ kind: string; total: number }>(
    `SELECT kind, COUNT(*) AS total FROM events
     WHERE created_at >= ?
     GROUP BY kind`,
    [fromTs],
  );
  const totalMap = new Map<string, number>();
  for (const r of totalRows) totalMap.set(r.kind, r.total);

  const uvRows = queryAll<{ uv: number }>(
    `SELECT COUNT(DISTINCT ip_hash) AS uv
     FROM sessions
     WHERE last_seen_at >= ?`,
    [fromTs],
  );

  const productClicks = queryAll<ProductClickSummary>(
    `SELECT ref, COUNT(*) AS total
     FROM events
     WHERE kind = 'product-click' AND created_at >= ?
     GROUP BY ref
     ORDER BY total DESC`,
    [fromTs],
  );

  return {
    totals: {
      pageView: totalMap.get('page-view') ?? 0,
      productClick: totalMap.get('product-click') ?? 0,
      imageExport: totalMap.get('image-export') ?? 0,
      uv: uvRows[0]?.uv ?? 0,
    },
    perDay,
    productClicks,
  };
}

export interface PublicTotals {
  pageView: number;
  imageExport: number;
}

export function queryPublicTotals(): PublicTotals {
  const rows = queryAll<{ kind: string; total: number }>(
    `SELECT kind, COUNT(*) AS total FROM events
     WHERE kind IN ('page-view', 'image-export')
     GROUP BY kind`,
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.kind, r.total);
  return {
    pageView: map.get('page-view') ?? 0,
    imageExport: map.get('image-export') ?? 0,
  };
}

export interface RegionBucket {
  province: string;
  city: string | null;
  pv: number;
  uv: number;
  selfPv: number;
  externalPv: number;
  externalUv: number;
}

export interface ProvinceBucket extends Omit<RegionBucket, 'city'> {
  share: number;
}

export interface RegionDayBucket {
  day: string;
  pv: number;
  selfPv: number;
  externalPv: number;
  externalUv: number;
}

export interface RegionsResult {
  totals: {
    pv: number;
    uv: number;
    selfPv: number;
    selfUv: number;
    externalPv: number;
    externalUv: number;
    unknownPv: number;
    unknownUv: number;
  };
  provinces: ProvinceBucket[];
  cities: RegionBucket[];
  perDay: RegionDayBucket[];
  coverage: {
    resolvedPv: number;
    resolvedUv: number;
    totalPv: number;
    totalUv: number;
  };
}

/** city 为空串 / NULL 时给前端一个占位，前端好过滤 */
const CITY_FALLBACK = '—';

interface ProvinceRow {
  province: string;
  pv: number;
  uv: number;
  self_pv: number;
  external_pv: number;
  external_uv: number;
}

/**
 * 省份 / 城市分布。
 *
 * 口径（刻意和现有 querySummary 对齐，避免两个接口数字打架）：
 * - PV 走 events，UV 走 sessions 的 `last_seen_at`
 * - 排行默认按「外部访客 PV」——需求就是看「谁来看我」
 * - province 为空的行不塞进任何真实省份，也不叫「境外」：境外、内网、库未覆盖
 *   三种情况混在一起会掩盖覆盖率问题，所以走 totals.unknown* + coverage 显式暴露
 */
export function queryRegions(days: number): RegionsResult {
  const now = Date.now();
  const fromTs = now - days * 24 * 60 * 60 * 1000;

  const totalsRow = queryAll<{ pv: number; self_pv: number; unknown_pv: number }>(
    `SELECT
       COUNT(*) AS pv,
       COALESCE(SUM(CASE WHEN is_self = 1 THEN 1 ELSE 0 END), 0) AS self_pv,
       COALESCE(SUM(CASE WHEN province IS NULL OR province = '' THEN 1 ELSE 0 END), 0) AS unknown_pv
     FROM events WHERE created_at >= ?`,
    [fromTs],
  )[0];

  const uvRow = queryAll<{ uv: number; self_uv: number; unknown_uv: number }>(
    `SELECT
       COUNT(DISTINCT ip_hash) AS uv,
       COUNT(DISTINCT CASE WHEN is_self = 1 THEN ip_hash END) AS self_uv,
       COUNT(DISTINCT CASE WHEN province IS NULL OR province = '' THEN ip_hash END) AS unknown_uv
     FROM sessions WHERE last_seen_at >= ?`,
    [fromTs],
  )[0];

  const provinceRows = queryAll<ProvinceRow>(
    `SELECT
       province AS province,
       COUNT(*) AS pv,
       COUNT(DISTINCT ip_hash) AS uv,
       COALESCE(SUM(CASE WHEN is_self = 1 THEN 1 ELSE 0 END), 0) AS self_pv,
       COALESCE(SUM(CASE WHEN is_self = 0 THEN 1 ELSE 0 END), 0) AS external_pv,
       COUNT(DISTINCT CASE WHEN is_self = 0 THEN ip_hash END) AS external_uv
     FROM events
     WHERE created_at >= ? AND province IS NOT NULL AND province <> ''
     GROUP BY province`,
    [fromTs],
  );

  const cityRows = queryAll<ProvinceRow & { city: string }>(
    `SELECT
       province AS province,
       COALESCE(NULLIF(city, ''), ?) AS city,
       COUNT(*) AS pv,
       COUNT(DISTINCT ip_hash) AS uv,
       COALESCE(SUM(CASE WHEN is_self = 1 THEN 1 ELSE 0 END), 0) AS self_pv,
       COALESCE(SUM(CASE WHEN is_self = 0 THEN 1 ELSE 0 END), 0) AS external_pv,
       COUNT(DISTINCT CASE WHEN is_self = 0 THEN ip_hash END) AS external_uv
     FROM events
     WHERE created_at >= ? AND province IS NOT NULL AND province <> ''
     GROUP BY province, city
     ORDER BY external_pv DESC
     LIMIT 200`,
    [CITY_FALLBACK, fromTs],
  );

  const perDayRows = queryAll<{ day: string; pv: number; self_pv: number; external_pv: number; external_uv: number }>(
    `SELECT
       day,
       COUNT(*) AS pv,
       COALESCE(SUM(CASE WHEN is_self = 1 THEN 1 ELSE 0 END), 0) AS self_pv,
       COALESCE(SUM(CASE WHEN is_self = 0 THEN 1 ELSE 0 END), 0) AS external_pv,
       COUNT(DISTINCT CASE WHEN is_self = 0 THEN ip_hash END) AS external_uv
     FROM events WHERE created_at >= ?
     GROUP BY day`,
    [fromTs],
  );
  const perDayMap = new Map(perDayRows.map(r => [r.day, r]));
  const perDay: RegionDayBucket[] = dayRange(fromTs, now).map(day => {
    const row = perDayMap.get(day);
    return {
      day,
      pv: row?.pv ?? 0,
      selfPv: row?.self_pv ?? 0,
      externalPv: row?.external_pv ?? 0,
      externalUv: row?.external_uv ?? 0,
    };
  });

  const totalPv = totalsRow?.pv ?? 0;
  const totalUv = uvRow?.uv ?? 0;
  const selfPv = totalsRow?.self_pv ?? 0;
  const selfUv = uvRow?.self_uv ?? 0;
  const externalPv = totalPv - selfPv;
  const externalUv = Math.max(0, totalUv - selfUv);

  // share 的分母是「已归属省份的外部 PV」，不是全站外部 PV——否则未归属的
  // 流量会让每个省的占比都偏小，看起来像"到处都有人但都很小"。
  const externalPvInProvinces = provinceRows.reduce((sum, r) => sum + r.external_pv, 0);
  const provinces: ProvinceBucket[] = provinceRows
    .map(r => ({
      province: r.province,
      pv: r.pv,
      uv: r.uv,
      selfPv: r.self_pv,
      externalPv: r.external_pv,
      externalUv: r.external_uv,
      share: externalPvInProvinces > 0 ? r.external_pv / externalPvInProvinces : 0,
    }))
    .sort((a, b) => b.externalPv - a.externalPv || b.pv - a.pv);

  return {
    totals: {
      pv: totalPv,
      uv: totalUv,
      selfPv,
      selfUv,
      externalPv,
      externalUv,
      unknownPv: totalsRow?.unknown_pv ?? 0,
      unknownUv: uvRow?.unknown_uv ?? 0,
    },
    provinces,
    cities: cityRows.map(r => ({
      province: r.province,
      city: r.city,
      pv: r.pv,
      uv: r.uv,
      selfPv: r.self_pv,
      externalPv: r.external_pv,
      externalUv: r.external_uv,
    })),
    perDay,
    coverage: {
      resolvedPv: provinceRows.reduce((sum, r) => sum + r.pv, 0),
      resolvedUv: provinceRows.reduce((sum, r) => sum + r.uv, 0),
      totalPv,
      totalUv,
    },
  };
}

export interface SettingRow {
  key: string;
  value: string;
  updatedAt: number;
  updatedBy: string;
}

const settingsCache = new Map<string, SettingRow>();

function rowToSetting(r: { key: string; value: string; updated_at: number; updated_by: string }): SettingRow {
  return { key: r.key, value: r.value, updatedAt: r.updated_at, updatedBy: r.updated_by };
}

export function loadAllSettings(): SettingRow[] {
  const rows = queryAll<{ key: string; value: string; updated_at: number; updated_by: string }>(
    `SELECT key, value, updated_at, updated_by FROM settings`,
  );
  settingsCache.clear();
  for (const r of rows) settingsCache.set(r.key, rowToSetting(r));
  return listAllSettings();
}

export function listAllSettings(): SettingRow[] {
  return Array.from(settingsCache.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function getSetting(key: string): SettingRow | null {
  const cached = settingsCache.get(key);
  if (cached) return { ...cached };
  const rows = queryAll<{ key: string; value: string; updated_at: number; updated_by: string }>(
    `SELECT key, value, updated_at, updated_by FROM settings WHERE key = ?`,
    [key],
  );
  if (rows.length === 0) return null;
  const row = rowToSetting(rows[0]);
  settingsCache.set(key, row);
  return { ...row };
}

export function setSetting(key: string, value: string, updatedBy: string): SettingRow {
  const now = Date.now();
  runStmt(
    `INSERT INTO settings(key, value, updated_at, updated_by)
       VALUES(?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    [key, value, now, updatedBy ?? ''],
  );
  const next: SettingRow = { key, value, updatedAt: now, updatedBy: updatedBy ?? '' };
  settingsCache.set(key, next);
  return { ...next };
}