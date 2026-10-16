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
  /** 仅 detail 携带：后台要显示「最后改于」，公开列表不暴露 */
  updatedAt: number;
}

/**
 * 后台专用的 detail，额外带 published。
 *
 * 公开契约刻意不含 published：公开接口只返回已上架作品，这个字段恒为 true，
 * 写进公开响应只会让客户端误以为「拿不到该字段 = 上架」这种反向推断成立。
 * 后台要区分草稿，所以单独一个形状，不污染 /api/public/*。
 */
export interface AdminWorkDetail extends WorkDetail {
  published: boolean;
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
 * multipart 的文本字段一律是字符串，JSON 接口可能送真 boolean，也可能送数字 0/1。
 * 空串 / '0' / 'false' / 数字 0 都算「明确的关」——未勾选的 checkbox 在 multipart 里
 * 干脆不出现（undefined），那种情况才走 fallback。
 */
export function normalizePublished(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  // 数字必须单独判：JSON 接口会送真 0，严格不等下 0 !== '0' 为真，
  // 落到末尾会把草稿判成「上架」——静默、且没有任何报错，是最难防的一类。
  if (typeof raw === 'number') return raw !== 0;
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

/** DB 里 published 是 0/1，JSON 侧统一成 boolean，避免前端去猜 0 和 '0' 的区别 */
function toAdminDetail(row: WorkRow): AdminWorkDetail {
  return { ...toDetail(row), published: row.published === 1 };
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
export function listAllWorks(): AdminWorkDetail[] {
  return queryAll<WorkRow>(
    `SELECT * FROM works ORDER BY created_at DESC, id DESC`
  ).map(toAdminDetail);
}

export async function createWork(input: CreateWorkInput): Promise<AdminWorkDetail> {
  const ext = extFor(input.image.mime, 'image');
  if (input.thumb) {
    const thumbExt = extFor(input.thumb.mime, 'thumb');
    if (thumbExt !== '.webp') throw new Error('thumb must be image/webp');
  }

  const hex = randomBytes(8).toString('hex');
  const imageKey = `works/${hex}${ext}`;
  const thumbKey = input.thumb ? `works/${hex}-t.webp` : '';
  let created: WorkRow[] = [];

  try {
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

    // 用 last_insert_rowid() 而不是 image_key 回读：image_key 碰撞的概率极低，
    // 但真撞上会「静默返回另一条作品的数据（含它的标题）」，不报错，最难排查。
    //
    // 顺序有讲究：必须在 flushNow() 之前读。flushNow() 里的 db.export() 会把
    // 连接的 last_insert_rowid 复位成 0（sql.js 实测），先 flush 再查必然查不到行。
    created = queryAll<WorkRow>(`SELECT * FROM works WHERE id = last_insert_rowid()`);
    if (!created[0]) throw new Error('createWork: missing after insert');
    flushNow();
  } catch (err) {
    // 参数都归一化过了，走到这里基本只剩 DB 故障。但文件已经落盘了 ——
    // 不回收就是一条没有记录、也没有主键可追溯的孤儿文件，只能靠人肉扫盘清理。
    await removeQuietly(imageKey);
    await removeQuietly(thumbKey);
    throw err;
  }

  return toAdminDetail(created[0]);
}

export async function updateWorkMeta(id: number, patch: UpdateWorkMeta): Promise<AdminWorkDetail> {
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
  return toAdminDetail(next);
}

export async function replaceWorkImage(
  id: number,
  image: WorkImage,
  thumb?: WorkImage
): Promise<AdminWorkDetail> {
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
  return toAdminDetail(next);
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
