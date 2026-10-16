import { randomBytes } from 'node:crypto';
import { queryAll, runStmt, flushNow } from './db.js';
import { storage } from './storage/index.js';

/**
 * 公开列表用的摘要。注意它刻意不含 description / imageUrl ——
 * 列表页只需要一张缩略图，把大图地址塞进列表响应是白给流量。
 */
export interface WorkSummary {
  id: number;
  title: string;
  thumbUrl: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface WorkDetail extends WorkSummary {
  description: string;
  imageUrl: string;
  bytes: number;
  /** 后台列表要按「最近改过的」排序，前台用不上，所以只在 detail 上给 */
  updatedAt: number;
}

export interface WorkImage {
  body: Buffer;
  mime: string;
}

export interface CreateWorkInput {
  title?: unknown;
  description?: unknown;
  published?: unknown;
  width?: unknown;
  height?: unknown;
  image: WorkImage;
  thumb?: WorkImage;
}

export interface UpdateWorkMeta {
  title?: string;
  description?: string;
  published?: boolean;
}

interface WorkRow {
  id: number;
  title: string;
  description: string;
  image_key: string;
  thumb_key: string;
  width: number;
  height: number;
  bytes: number;
  published: number;
  created_at: number;
  updated_at: number;
}

const MAX_DESCRIPTION = 2000;
const MAX_TITLE = 200;
const FALLBACK_TITLE = '未命名作品';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

function normalizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') return FALLBACK_TITLE;
  const t = raw.trim();
  if (t.length === 0) return FALLBACK_TITLE;
  return t.slice(0, MAX_TITLE);
}

function normalizeDescription(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.slice(0, MAX_DESCRIPTION);
}

function normalizeDimension(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * multipart 的文本字段一律是字符串，JSON 接口则是真 boolean。
 * 空串 / '0' / 'false' 都算「明确的关」——未勾选的 checkbox 在 multipart 里
 * 干脆不出现（undefined），那种情况才走 fallback。
 */
export function normalizePublished(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  return raw !== '' && raw !== '0' && raw !== 'false';
}

function toSummary(row: WorkRow): WorkSummary {
  return {
    id: row.id,
    title: row.title,
    thumbUrl: storage.publicUrl(row.thumb_key || row.image_key),
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
}

function toDetail(row: WorkRow): WorkDetail {
  return {
    ...toSummary(row),
    description: row.description,
    imageUrl: storage.publicUrl(row.image_key),
    bytes: row.bytes,
    updatedAt: row.updated_at,
  };
}

function rowById(id: number): WorkRow | null {
  const rows = queryAll<WorkRow>(`SELECT * FROM works WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

function requireRow(id: number): WorkRow {
  const row = rowById(id);
  if (!row) throw new Error('work not found');
  return row;
}

function extFor(mime: string, what: string): string {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`unsupported ${what} mime type`);
  return ext;
}

export function listPublishedWorks(
  limit: number,
  offset: number
): { items: WorkSummary[]; total: number } {
  // 钳到 [1,60]。注意不能写 `Math.floor(limit) || 20`：limit=0 是「非法值要钳到
  // 最小值 1」，不是「没传值走默认 20」，`||` 会把 0 当成假值改成 20。
  const raw = Number.isFinite(limit) ? Math.floor(limit) : 20;
  const lim = Math.max(1, Math.min(60, raw));
  const off = Math.max(0, Math.floor(offset) || 0);
  const rows = queryAll<WorkRow>(
    `SELECT * FROM works
      WHERE published = 1
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [lim, off]
  );
  const totalRows = queryAll<{ total: number }>(
    `SELECT COUNT(*) AS total FROM works WHERE published = 1`
  );
  return { items: rows.map(toSummary), total: totalRows[0]?.total ?? 0 };
}

/** 草稿一律返回 null —— 不区分「不存在」和「未上架」，避免用状态码探测草稿。 */
export function getPublishedWork(id: number): WorkDetail | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = rowById(id);
  if (!row || row.published !== 1) return null;
  return toDetail(row);
}

/** 后台管理用：含草稿。 */
export function listAllWorks(): WorkDetail[] {
  return queryAll<WorkRow>(
    `SELECT * FROM works ORDER BY created_at DESC, id DESC`
  ).map(toDetail);
}

export async function createWork(input: CreateWorkInput): Promise<WorkDetail> {
  const ext = extFor(input.image.mime, 'image');
  if (input.thumb) {
    const thumbExt = extFor(input.thumb.mime, 'thumb');
    if (thumbExt !== '.webp') throw new Error('thumb must be image/webp');
  }

  const hex = randomBytes(8).toString('hex');
  const imageKey = `works/${hex}${ext}`;
  const thumbKey = input.thumb ? `works/${hex}-t.webp` : '';

  await storage.put(imageKey, input.image.body, input.image.mime);
  if (input.thumb) {
    // 缩略图写失败不回滚原图和记录：没有缩略图是可降级状态
    // （前端会用原图当缩略图），强行失败反而让用户白传一次大图
    await storage.put(thumbKey, input.thumb.body, input.thumb.mime).catch(e => {
      console.warn('[works] 缩略图写入失败，降级为无缩略图', e);
    });
  }

  const now = Date.now();
  runStmt(
    `INSERT INTO works
       (title, description, image_key, thumb_key, width, height, bytes, published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizeTitle(input.title),
      normalizeDescription(input.description),
      imageKey,
      thumbKey,
      normalizeDimension(input.width),
      normalizeDimension(input.height),
      input.image.body.byteLength,
      normalizePublished(input.published, true) ? 1 : 0,
      now,
      now,
    ]
  );
  flushNow();

  const created = queryAll<WorkRow>(`SELECT * FROM works WHERE image_key = ?`, [imageKey]);
  if (!created[0]) throw new Error('createWork: missing after insert');
  return toDetail(created[0]);
}

export async function updateWorkMeta(id: number, patch: UpdateWorkMeta): Promise<WorkDetail> {
  const row = requireRow(id);
  const next: WorkRow = { ...row };
  if (typeof patch.title === 'string') next.title = normalizeTitle(patch.title);
  if (typeof patch.description === 'string') next.description = normalizeDescription(patch.description);
  if (typeof patch.published === 'boolean') next.published = patch.published ? 1 : 0;
  next.updated_at = Date.now();

  runStmt(
    `UPDATE works SET title=?, description=?, published=?, updated_at=? WHERE id=?`,
    [next.title, next.description, next.published, next.updated_at, id]
  );
  flushNow();
  return toDetail(next);
}

export async function replaceWorkImage(
  id: number,
  image: WorkImage,
  thumb?: WorkImage
): Promise<WorkDetail> {
  const row = requireRow(id);
  const ext = extFor(image.mime, 'image');
  if (thumb) {
    const thumbExt = extFor(thumb.mime, 'thumb');
    if (thumbExt !== '.webp') throw new Error('thumb must be image/webp');
  }

  const hex = randomBytes(8).toString('hex');
  const imageKey = `works/${hex}${ext}`;
  const thumbKey = thumb ? `works/${hex}-t.webp` : '';

  await storage.put(imageKey, image.body, image.mime);
  if (thumb) {
    await storage.put(thumbKey, thumb.body, thumb.mime).catch(e => {
      console.warn('[works] 缩略图写入失败，降级为无缩略图', e);
    });
  }

  const next: WorkRow = {
    ...row,
    image_key: imageKey,
    thumb_key: thumbKey,
    bytes: image.body.byteLength,
    updated_at: Date.now(),
  };
  runStmt(
    `UPDATE works SET image_key=?, thumb_key=?, bytes=?, updated_at=? WHERE id=?`,
    [imageKey, thumbKey, next.bytes, next.updated_at, id]
  );

  // 记录指向新文件之后才删旧文件：反过来若删失败，会留下一条指向已删文件的记录
  await removeQuietly(row.image_key);
  await removeQuietly(row.thumb_key);

  flushNow();
  return toDetail(next);
}

export async function deleteWork(id: number): Promise<void> {
  const row = requireRow(id);
  // 先删文件、再删记录。反过来会在「记录已删、文件删失败」时留下永远无人引用的
  // 孤儿文件，而孤儿文件没有主键可追溯，后续清理无从下手。
  // 文件删失败只 warn 不阻断 —— 记录必须删掉，否则前台会一直显示点开 404 的卡片。
  await removeQuietly(row.image_key);
  await removeQuietly(row.thumb_key);
  runStmt(`DELETE FROM works WHERE id = ?`, [id]);
  flushNow();
}

async function removeQuietly(key: string): Promise<void> {
  if (!key) return;
  try {
    await storage.delete(key);
  } catch (e) {
    console.warn('[works] 文件删除失败（可能已是孤儿文件）', key, e);
  }
}
