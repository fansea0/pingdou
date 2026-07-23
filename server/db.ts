import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.STATS_DB_PATH ?? resolve(process.cwd(), 'data/stats.db');
const WASM_PATH = resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');

mkdirSync(dirname(DB_PATH), { recursive: true });

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
      ip_hash TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_day ON events(day);
    CREATE INDEX IF NOT EXISTS idx_events_ref ON events(ref);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      day TEXT NOT NULL
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
      product_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_assignment
      ON product_assignments(product_id) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_assignments_user_active
      ON product_assignments(user_id, revoked_at);

    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
  `);

  flushNow();

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
}): void {
  const now = Date.now();
  const day = isoDay(now);
  runStmt(
    `INSERT INTO events (kind, ref, created_at, day, ip_hash) VALUES (?, ?, ?, ?, ?)`,
    [opts.kind, opts.ref ?? null, now, day, opts.ipHash],
  );
  if (opts.sid) {
    runStmt(
      `INSERT INTO sessions (id, ip_hash, created_at, last_seen_at, day)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         day = excluded.day`,
      [opts.sid, opts.ipHash, now, now, day],
    );
  }
}

export function touchSession(opts: {
  sid: string;
  ipHash: string;
}): { day: string } {
  const now = Date.now();
  const day = isoDay(now);
  runStmt(
    `INSERT INTO sessions (id, ip_hash, created_at, last_seen_at, day)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       day = excluded.day`,
    [opts.sid, opts.ipHash, now, now, day],
  );
  return { day };
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