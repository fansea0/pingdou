import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';

type DbApi = {
  initDb: () => Promise<void>;
  runStmt: (sql: string, params: (number | string | null)[]) => void;
  queryAll: <T = Record<string, unknown>>(sql: string, params?: (number | string | null)[]) => T[];
  trackEvent: (opts: {
    kind: 'page-view' | 'product-click' | 'image-export';
    ref?: string;
    ipHash: string;
    sid?: string;
    province?: string | null;
    city?: string | null;
    isSelf?: boolean;
  }) => void;
  touchSession: (opts: {
    sid: string; ipHash: string; province?: string | null; city?: string | null; isSelf?: boolean;
  }) => { day: string };
  queryRegions: (days: number) => import('../../../server/db.js').RegionsResult;
  querySummary: (days: number) => import('../../../server/db.js').SummaryResult;
};

let tmp = '';
let dbPath = '';

async function freshDb(): Promise<DbApi> {
  tmp = mkdtempSync(join(tmpdir(), `regions-test-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  dbPath = join(tmp, 'stats.db');
  process.env.PINGDOU_DATA_DIR = tmp;
  vi.resetModules();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db as unknown as DbApi;
}

/**
 * 造一个「功能上线前」的旧库：只有 events / sessions 两张老表，没有 province / is_self。
 * 用来验证老库直接启动不炸、老数据不丢、行为不变。
 */
async function writeLegacyDb(): Promise<string> {
  tmp = mkdtempSync(join(tmpdir(), `regions-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  dbPath = join(tmp, 'stats.db');
  const SQL = await initSqlJs({
    locateFile: (file: string) => join(process.cwd(), 'node_modules/sql.js/dist', file),
  });
  const legacy = new SQL.Database();
  legacy.run(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref TEXT,
      created_at INTEGER NOT NULL,
      day TEXT NOT NULL,
      ip_hash TEXT
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      day TEXT NOT NULL
    );
  `);
  const now = Date.now();
  legacy.run(`INSERT INTO events (kind, ref, created_at, day, ip_hash) VALUES ('page-view', NULL, ${now}, '2026-10-14', '1.1.1.1')`);
  legacy.run(`INSERT INTO sessions (id, ip_hash, created_at, last_seen_at, day) VALUES ('legacy-sid', '1.1.1.1', ${now}, ${now}, '2026-10-14')`);
  writeFileSync(dbPath, Buffer.from(legacy.export()));
  legacy.close();
  return tmp;
}

function seed(db: DbApi, e: {
  ip: string; province?: string | null; city?: string | null; isSelf?: boolean; sid?: string; kind?: 'page-view' | 'product-click' | 'image-export';
}): void {
  db.trackEvent({
    kind: e.kind ?? 'page-view',
    ipHash: e.ip,
    sid: e.sid,
    province: e.province ?? null,
    city: e.city ?? null,
    isSelf: e.isSelf ?? false,
  });
}

beforeEach(() => {
  if (dbPath && existsSync(dbPath)) unlinkSync(dbPath);
  delete process.env.PINGDOU_DATA_DIR;
});

afterEach(() => {
  delete process.env.PINGDOU_DATA_DIR;
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('老库自动升级（兼容现有存储结构）', () => {
  it('没有新列的旧库能直接启动，且老数据一行不少', async () => {
    const legacyDir = await writeLegacyDb();
    process.env.PINGDOU_DATA_DIR = legacyDir;
    vi.resetModules();
    const db = await import('../../../server/db.js');
    await db.initDb();

    const legacyRows = db.queryAll<{ n: number }>(`SELECT COUNT(*) AS n FROM events`);
    expect(legacyRows[0].n).toBe(1);
    const legacySessions = db.queryAll<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions`);
    expect(legacySessions[0].n).toBe(1);

    // 老行的新列是 NULL / 0，而不是被塞了假数据
    const row = db.queryAll<{ province: string | null; city: string | null; is_self: number }>(
      `SELECT province, city, is_self FROM events`,
    )[0];
    expect(row.province).toBeNull();
    expect(row.city).toBeNull();
    expect(row.is_self).toBe(0);

    // 老查询一个字段都没多，行为不变
    const summary = db.querySummary(90);
    expect(summary.totals.pageView).toBe(1);
    expect(summary.totals.uv).toBe(1);

    db.flushNow();
  });

  it('升级是幂等的：连续两次 initDb 不会因列已存在而报错', async () => {
    tmp = mkdtempSync(join(tmpdir(), `regions-idem-${Date.now()}-`));
    dbPath = join(tmp, 'stats.db');
    process.env.PINGDOU_DATA_DIR = tmp;
    vi.resetModules();
    const db = await import('../../../server/db.js');
    await db.initDb();
    await expect(db.initDb()).resolves.toBeUndefined();
    db.flushNow();
  });
});

describe('trackEvent 写入归属与自我标记', () => {
  it('省市和 is_self 一起落库', async () => {
    const db = await freshDb();
    seed(db, { ip: '1.1.1.1', province: '广东省', city: '深圳市', sid: 's1' });
    seed(db, { ip: '1.1.1.1', province: '广东省', city: '深圳市', isSelf: true, sid: 's2' });

    const rows = db.queryAll<{ province: string; city: string; is_self: number }>(
      `SELECT province, city, is_self FROM events ORDER BY id`,
    );
    expect(rows[0]).toMatchObject({ province: '广东省', city: '深圳市', is_self: 0 });
    expect(rows[1]).toMatchObject({ province: '广东省', city: '深圳市', is_self: 1 });
  });

  it('session 只保留最新一次的归属', async () => {
    const db = await freshDb();
    seed(db, { ip: '1.1.1.1', province: '广东省', city: '深圳市', sid: 'same-sid' });
    seed(db, { ip: '2.2.2.2', province: '浙江省', city: '杭州市', isSelf: true, sid: 'same-sid' });

    const rows = db.queryAll<{ province: string; is_self: number }>(
      `SELECT province, is_self FROM sessions`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ province: '浙江省', is_self: 1 });
  });

  it('touchSession 也会刷新归属', async () => {
    const db = await freshDb();
    db.touchSession({ sid: 's9', ipHash: '3.3.3.3', province: '北京市', city: '北京市' });
    db.touchSession({ sid: 's9', ipHash: '3.3.3.3', province: '北京市', city: '北京市', isSelf: true });
    const rows = db.queryAll<{ is_self: number }>(`SELECT is_self FROM sessions`);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_self).toBe(1);
  });
});

describe('queryRegions 聚合口径', () => {
  it('外部 / 内部拆分正确，省份按外部 PV 排序且 share 归一', async () => {
    const db = await freshDb();
    // 广东：外部 3 + 内部 2
    seed(db, { ip: 'a1', province: '广东省', city: '深圳市', sid: 'a1' });
    seed(db, { ip: 'a2', province: '广东省', city: '深圳市', sid: 'a2' });
    seed(db, { ip: 'a3', province: '广东省', city: '广州市', sid: 'a3' });
    seed(db, { ip: 'me', province: '广东省', city: '深圳市', isSelf: true, sid: 'me1' });
    seed(db, { ip: 'me', province: '广东省', city: '深圳市', isSelf: true, sid: 'me2' });
    // 浙江：外部 1
    seed(db, { ip: 'b1', province: '浙江省', city: '杭州市', sid: 'b1' });
    // 未归属：外部 1
    seed(db, { ip: 'c1', province: null, city: null, sid: 'c1' });

    const r = db.queryRegions(30);
    expect(r.totals.pv).toBe(7);
    expect(r.totals.selfPv).toBe(2);
    expect(r.totals.externalPv).toBe(5);
    expect(r.totals.unknownPv).toBe(1);

    expect(r.provinces.map(p => p.province)).toEqual(['广东省', '浙江省']);
    const gd = r.provinces[0];
    expect(gd.pv).toBe(5);
    expect(gd.selfPv).toBe(2);
    expect(gd.externalPv).toBe(3);
    // share 分母是已归属省份的外部 PV = 3 + 1
    expect(gd.share).toBeCloseTo(0.75, 5);
    expect(r.provinces[1].share).toBeCloseTo(0.25, 5);

    expect(r.cities.map(c => `${c.province}/${c.city}`)).toEqual([
      '广东省/深圳市', '广东省/广州市', '浙江省/杭州市',
    ]);
    const sz = r.cities[0];
    expect(sz.externalPv).toBe(2);
    expect(sz.selfPv).toBe(2);
  });

  it('city 为空时给占位符，不和 NULL 混成一桶', async () => {
    const db = await freshDb();
    seed(db, { ip: 'a1', province: '广东省', city: null, sid: 'a1' });
    const r = db.queryRegions(30);
    expect(r.cities).toHaveLength(1);
    expect(r.cities[0].city).toBe('—');
  });

  it('未归属流量不进任何省份桶，但 coverage 显式暴露缺口', async () => {
    const db = await freshDb();
    seed(db, { ip: 'a1', province: '广东省', city: '深圳市', sid: 'a1' });
    seed(db, { ip: 'c1', province: null, city: null, sid: 'c1' });
    seed(db, { ip: 'c2', province: null, city: null, sid: 'c2' });

    const r = db.queryRegions(30);
    expect(r.provinces).toHaveLength(1);
    expect(r.totals.unknownPv).toBe(2);
    expect(r.totals.unknownUv).toBe(2);
    expect(r.coverage.resolvedPv).toBe(1);
    expect(r.coverage.totalPv).toBe(3);
  });

  it('perDay 按外部 UV 去重，外部在内部之外单独成列', async () => {
    const db = await freshDb();
    seed(db, { ip: 'a1', province: '广东省', city: '深圳市', sid: 'a1' });
    seed(db, { ip: 'a1', province: '广东省', city: '深圳市', sid: 'a1' });
    seed(db, { ip: 'me', province: '广东省', city: '深圳市', isSelf: true, sid: 'me' });

    const r = db.queryRegions(30);
    const today = r.perDay[r.perDay.length - 1];
    expect(today.pv).toBe(3);
    expect(today.selfPv).toBe(1);
    expect(today.externalPv).toBe(2);
    expect(today.externalUv).toBe(1);
  });

  it('时间窗之外的数据不计入', async () => {
    const db = await freshDb();
    seed(db, { ip: 'a1', province: '广东省', city: '深圳市', sid: 'a1' });
    db.runStmt(`UPDATE events SET created_at = ? WHERE id = 1`, [Date.now() - 40 * 24 * 3600 * 1000]);
    const r = db.queryRegions(7);
    expect(r.totals.pv).toBe(0);
    expect(r.provinces).toHaveLength(0);
  });

  it('空库不炸，返回全 0 且 perDay 铺满整个时间窗', async () => {
    const db = await freshDb();
    const r = db.queryRegions(30);
    expect(r.totals.pv).toBe(0);
    expect(r.provinces).toEqual([]);
    expect(r.cities).toEqual([]);
    expect(r.perDay).toHaveLength(31);
    expect(r.coverage.totalPv).toBe(0);
  });
});
