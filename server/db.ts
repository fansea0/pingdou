import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.STATS_DB_PATH ?? resolve(process.cwd(), 'data/stats.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

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
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    ip_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    day TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day);
`);

const insertStmt = db.prepare(`
  INSERT INTO events (kind, ref, created_at, day, ip_hash)
  VALUES (?, ?, ?, ?, ?)
`);

const upsertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, ip_hash, created_at, last_seen_at, day)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    last_seen_at = excluded.last_seen_at,
    day = excluded.day
`);

export function trackEvent(opts: {
  kind: 'page-view' | 'product-click' | 'image-export';
  ref?: string;
  ipHash: string;
  sid?: string;
}): void {
  const now = Date.now();
  const day = isoDay(now);
  insertStmt.run(opts.kind, opts.ref ?? null, now, day, opts.ipHash);
  if (opts.sid) {
    upsertSessionStmt.run(opts.sid, opts.ipHash, now, now, day);
  }
}

export function touchSession(opts: {
  sid: string;
  ipHash: string;
}): { day: string } {
  const now = Date.now();
  const day = isoDay(now);
  upsertSessionStmt.run(opts.sid, opts.ipHash, now, now, day);
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

  const perDayStmt = db.prepare(`
    SELECT day, COUNT(*) AS total
    FROM events
    WHERE created_at >= ?
    GROUP BY day
    ORDER BY day ASC
  `);
  const perDayRaw = perDayStmt.all(fromTs) as { day: string; total: number }[];

  const perDayMap = new Map<string, number>();
  for (const row of perDayRaw) {
    perDayMap.set(row.day, row.total);
  }
  const allDays = dayRange(fromTs, now);
  const perDay: BucketSummary[] = allDays.map(day => ({
    day,
    total: perDayMap.get(day) ?? 0,
  }));

  const totalStmt = db.prepare(`
    SELECT kind, COUNT(*) AS total FROM events
    WHERE created_at >= ?
    GROUP BY kind
  `);
  const totalRows = totalStmt.all(fromTs) as { kind: string; total: number }[];
  const totalMap = new Map<string, number>();
  for (const r of totalRows) totalMap.set(r.kind, r.total);

  const uvStmt = db.prepare(`
    SELECT COUNT(DISTINCT ip_hash) AS uv
    FROM sessions
    WHERE last_seen_at >= ?
  `);
  const uvRow = uvStmt.get(fromTs) as { uv: number };

  const productClickStmt = db.prepare(`
    SELECT ref, COUNT(*) AS total
    FROM events
    WHERE kind = 'product-click' AND created_at >= ?
    GROUP BY ref
    ORDER BY total DESC
  `);
  const productClicks = productClickStmt.all(fromTs) as ProductClickSummary[];

  return {
    totals: {
      pageView: totalMap.get('page-view') ?? 0,
      productClick: totalMap.get('product-click') ?? 0,
      imageExport: totalMap.get('image-export') ?? 0,
      uv: uvRow?.uv ?? 0,
    },
    perDay,
    productClicks,
  };
}