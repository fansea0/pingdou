import { createHash, randomBytes } from 'node:crypto';
import { queryAll, runStmt, execReturning, isoDay, flushNow } from './db.js';
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
  /** 总点赞数。直接读 works.likes 列 —— 列表查询不做任何聚合。 */
  likes: number;
}

export type WorkStatus = 'pending' | 'approved' | 'rejected';

/**
 * 图纸参数。详情页与后台审核队列要展示，公开列表不需要 ——
 * 列表页每张卡片只显示标题和缩略图，塞进去是白给流量。
 */
export interface WorkParams {
  /** 图纸宽度，单位格（如 87）。与 height 一起构成「87 × 62」的尺寸。 */
  boardW: number;
  boardH: number;
  /** 实际画出的豆子数（已扣掉被去掉的背景格）。 */
  beanCount: number;
  /** 图纸用到的色号种数。 */
  colorCount: number;
  /** 预估装配工时，单位分钟。展示层走 formatAssemblyHours，不存文案。 */
  estimateMinutes: number;
}

export interface WorkDetail extends WorkSummary, WorkParams {
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
  /** 审核态。与 published 同样只出现在后台形状里：公开接口只返回已过审作品，
   *  这个字段恒为 'approved'，写进公开响应只是废话。 */
  status: WorkStatus;
}

export interface WorkImage {
  body: Buffer;
  mime: string;
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
  likes: number;
  // 2026-10-17 用户投稿新增
  status: string;
  board_w: number;
  board_h: number;
  bean_count: number;
  color_count: number;
  estimate_minutes: number;
  upload_token: string;
}

const MAX_DESCRIPTION = 2000;
const MAX_TITLE = 200;
const FALLBACK_TITLE = '未命名作品';

// ---- 投稿（2026-10-17） ----

/** 投稿参数不合法。由 HTTP 层映射成 400。 */
export class SubmissionInputError extends Error {}

/** 当日投稿额度用尽。由 HTTP 层映射成 429。 */
export class SubmissionQuotaError extends Error {}

const MAX_BOARD_CELL = 500;
const MAX_BEAN_COUNT = 250_000;
const MAX_COLOR_COUNT = 221;
const MAX_ESTIMATE_MINUTES = 100_000;
const MAX_IMAGE_DIM = 20_000;

/**
 * 投稿数字字段的严格校验。
 *
 * **关键防线是 `Number.isInteger`，不是上面那半句 `typeof`。** 实测：把
 * `typeof raw !== 'number'` 整句删掉，`true` / `null` / `NaN` / `'87'` 依然全被拒
 * （`Number.isInteger` 对它们一律返回 false），所以那句 typeof 是把意图写在明面上的
 * 冗余，删掉不改变行为 —— 别把它当成「挡住 true 的那道防线」，也别因此以为可以
 * 顺手换成 `Number(raw)`：换成 Number() 之后 `true` 变 1（1 格宽的图纸）、`null`
 * 变 0（0 颗豆子），全部静默通过、不报任何错。
 *
 * 为什么宁可拒也不能静默兜底：这四个数字会原样出现在审核队列和作品详情页上，
 * 被静默转成 0 会让站主以为这是张空图、让访客以为「0 颗豆子」。
 */
function requireCount(raw: unknown, field: string, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new SubmissionInputError(`${field} 不是合法数值（应为 ${min}–${max} 的整数）`);
  }
  return raw;
}

/**
 * multipart 文本字段都是字符串，所以这一处才放宽成先 Number()。
 * 非法值一律落 0（详情页显示「未知」），不抛错 —— 图片本身已经是有效 PNG，
 * 尺寸只是元数据，为此拒绝整次投稿不划算。
 */
function optionalCount(raw: unknown, max: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 && n <= max ? n : 0;
}

/** 投稿必须填名称。与 normalizeTitle 不同：那里空标题回落成「未命名作品」，这里空标题是错误。 */
function requireTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw new SubmissionInputError('名称必须是文本');
  const t = raw.trim();
  if (t.length === 0) throw new SubmissionInputError('名称不能为空');
  return t.slice(0, MAX_TITLE);
}

export interface CreatedSubmission {
  id: number;
  /** 32 个 hex 字符（randomBytes(16)，即 128 位随机）。只在这一次响应里出现。
   *  id 是可猜的自增整数，令牌是第二道闸。 */
  uploadToken: string;
}

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

/**
 * likes 直接从 works.likes 列读，**没有 JOIN、没有子查询、没有聚合**。
 *
 * 这正是本次改造的全部意义：原来这里是
 * `LEFT JOIN (SELECT work_id, COUNT(*) FROM work_likes GROUP BY work_id)`，
 * 每发一次列表请求就要对整张赞数表扫一遍做分组 —— 页面访问量直接乘在 DB 的
 * 全表聚合上，且赞数表只增不减、永远不回收，表越大越慢。
 *
 * 反过来也要盯着：**别再把任何 JOIN 加回这里**。若将来赞数又需要「按天统计 /
 * 找出点赞明细」，那是另一个表、另一个查询，别把它挂回列表路径。
 *
 * likes 之所以还写 `?? 0`：行类型上它是必填，但 SQL 层的 NULL 兜底成本是零，
 * 而一旦某天有人手写 SQL 改库写进 NULL，这里会静默变成 undefined 让前端拿到
 * `NaN` 渲染。取 0 是明确的安全退路。
 */
function toSummary(row: WorkRow): WorkSummary {
  return {
    id: row.id,
    title: row.title,
    thumbUrl: storage.publicUrl(row.thumb_key || row.image_key),
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    likes: row.likes ?? 0,
  };
}

function paramsOf(row: WorkRow): WorkParams {
  return {
    boardW: row.board_w ?? 0,
    boardH: row.board_h ?? 0,
    // ?? 0 与 likes 同理：行类型上必填，但手工 SQL 改库写进 NULL 时，
    // 前端会拿到 NaN 渲染。取 0 是明确的安全退路。
    beanCount: row.bean_count ?? 0,
    colorCount: row.color_count ?? 0,
    estimateMinutes: row.estimate_minutes ?? 0,
  };
}

/**
 * likes 从 row 上读：detail 的调用方（getPublishedWork / listAllWorks /
 * updateWorkMeta / attachSubmissionImage）全部经 rowById 或列表查询拿到行，
 * 都会带上真值。
 */
function toDetail(row: WorkRow): WorkDetail {
  return {
    ...toSummary(row),
    ...paramsOf(row),
    description: row.description,
    imageUrl: storage.publicUrl(row.image_key),
    bytes: row.bytes,
    updatedAt: row.updated_at,
  };
}

/** DB 里 published 是 0/1、status 是文本，JSON 侧统一成 boolean / 枚举。 */
function toAdminDetail(row: WorkRow): AdminWorkDetail {
  return {
    ...toDetail(row),
    published: row.published === 1,
    status: (row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending'),
  };
}

/**
 * 带点赞数回读单行。SELECT w.* 已包含 likes 列，不需要任何额外 join。
 */
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

export type WorkSort = 'latest' | 'hot';

/**
 * LIKE 的元字符转义。用户搜 "50%" 必须按字面匹配，不能变成通配符扫全表。
 * 反斜杠自己也要转义，否则用户搜 "c\d" 会先被 \d 破坏掉。
 *
 * 附带一条**有意为之**的行为：SQLite 的 LIKE 对 ASCII 大小写不敏感，
 * 所以搜 "HELLO" 会命中 "Hello World" 也会命中 "hello world"（实测 total=2）。
 * 中文标题无影响，这多半就是想要的效果（用户不区分大小写），因此不改 ——
 * 后人看到"搜大写也命中小写"别当 bug 去修，真要改成大小写敏感得走
 * `GLOB` 或 `lower()` 双写，那是产品口径变更，不属于本函数。
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, ch => `\\${ch}`);
}

export function listPublishedWorks(opts: {
  limit: number;
  offset: number;
  q?: string;
  sort: WorkSort;
}): { items: WorkSummary[]; total: number } {
  const { limit, offset, sort } = opts;
  // 钳到 [1,60]。注意不能写 `Math.floor(limit) || 20`：limit=0 是「非法值要钳到
  // 最小值 1」，不是「没传值走默认 20」，`||` 会把 0 当成假值改成 20。
  const raw = Number.isFinite(limit) ? Math.floor(limit) : 20;
  const lim = Math.max(1, Math.min(60, raw));
  const off = Math.max(0, Math.floor(offset) || 0);

  // 三处 WHERE（列表 / 有 q 的列表 / COUNT）必须字面一致，否则 hasMore 会一直显示。
  //
  // `status = 'approved'` 是**独立于** published 的第二道过滤，不依赖
  // 「published=1 蕴含已过审」这个不变量成立：那是不变量①在接口层的防手滑，
  // 这里是万一①被绕过后的兜底。公开路径的正确性不该建立在另一条约束没被违反之上。
  const q = (opts.q ?? '').trim().slice(0, 100);
  const where = q
    ? `WHERE w.published = 1 AND w.status = 'approved' AND w.title LIKE ? ESCAPE '\\'`
    : `WHERE w.published = 1 AND w.status = 'approved'`;
  const likeParam = q ? `%${escapeLike(q)}%` : null;

  // 排序必须完全确定，否则每次请求顺序抖动会导致 React 重复 key、滚动跳变。
  // hot 的兜底链是 created_at 再 id —— 同赞数时先看谁更晚传，再按 id 定死。
  // likes 直接读列（idx_works_published_likes 覆盖这条 ORDER BY），无聚合。
  //
  // 已知取舍（用户已接受，非 bug）：hot 排序下每次点赞都会改变排名，
  // offset 分页因此可能跳过被挤下去的条目。Task 7 的 id 去重只能挡重复、挡不住跳过。
  // 根治要游标分页 WHERE (likes, created_at, id) < (?, ?, ?)，当前作品量级不值得。
  const orderBy = sort === 'hot'
    ? `ORDER BY w.likes DESC, w.created_at DESC, w.id DESC`
    : `ORDER BY w.created_at DESC, w.id DESC`;

  const rows = queryAll<WorkRow>(
    `SELECT w.*
       FROM works w
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    likeParam === null ? [lim, off] : [likeParam, lim, off]
  );

  const totalRows = queryAll<{ total: number }>(
    `SELECT COUNT(*) AS total FROM works w ${where}`,
    likeParam === null ? [] : [likeParam]
  );

  return {
    items: rows.map(toSummary),
    total: totalRows[0]?.total ?? 0,
  };
}

/** 未过审 / 已下架 / 不存在一律返回 null —— 不区分三者的原因与既有立场一致：
 *  区分开等于告诉访客这个 id 曾经存在过。 */
export function getPublishedWork(id: number): WorkDetail | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = rowById(id);
  if (!row || row.published !== 1 || row.status !== 'approved') return null;
  return toDetail(row);
}

/**
 * 后台管理用：默认全部，含 pending。含草稿。
 *
 * `status` 不传就是全量 —— 与改动前行为完全一致，调用方不传参数时行为不变。
 *
 * likes 同公开列表一样直读 works.likes 列（SELECT w.* 已包含它），不需要 join 或额外计数。
 */
export function listAllWorks(filter?: { status?: WorkStatus }): AdminWorkDetail[] {
  const where = filter?.status ? `WHERE w.status = ?` : '';
  const params = filter?.status ? [filter.status] : [];
  return queryAll<WorkRow>(
    `SELECT w.*
       FROM works w
       ${where}
      ORDER BY w.created_at DESC, w.id DESC`,
    params
  ).map(toAdminDetail);
}

export async function updateWorkMeta(id: number, patch: UpdateWorkMeta): Promise<AdminWorkDetail> {
  const row = requireRow(id);
  // next 连 likes 一起带过去：rowById 已经读到真值，而本函数不碰 likes，
  // 所以「函数开头读到的赞数」到 return 时仍然成立 —— 不需要为 likes 再查一次库。
  const next: WorkRow = { ...row };
  if (typeof patch.title === 'string') next.title = normalizeTitle(patch.title);
  if (typeof patch.description === 'string') next.description = normalizeDescription(patch.description);
  // 不变量①：published=1 必须伴随 status='approved'。
  // 让「未过审的东西上了架」在接口层就不可能发生，而不是指望前端 UI 不给这个选项。
  if (patch.published === true && row.status !== 'approved') {
    throw new Error('只有审核通过的作品才能上架');
  }
  if (typeof patch.published === 'boolean') next.published = patch.published ? 1 : 0;
  next.updated_at = Date.now();

  runStmt(
    `UPDATE works SET title=?, description=?, published=?, updated_at=? WHERE id=?`,
    [next.title, next.description, next.published, next.updated_at, id]
  );
  flushNow();
  return toAdminDetail(next);
}

/**
 * 审核通过：pending → approved，并自动上架。
 *
 * 已经 approved 时**原样返回当前状态**（真幂等），而不是重新上架 ——
 * 否则站主点过一次「通过」、再点「下架」、又误点一次「通过」，作品就自己回到
 * 前台了。UI 上「通过」按钮只对 pending 行显示，这条路径实际走不到，
 * 但 API 层的幂等必须是无副作用的。
 */
export function approveWork(id: number): AdminWorkDetail {
  const row = requireRow(id);
  if (row.status === 'rejected') {
    throw new Error('已拒绝的投稿不能通过');
  }
  if (row.status === 'approved') return toAdminDetail(row);
  const now = Date.now();
  runStmt(
    `UPDATE works SET status='approved', published=1, updated_at=? WHERE id=?`,
    [now, id],
  );
  flushNow();
  return toAdminDetail({ ...row, status: 'approved', published: 1, updated_at: now });
}

/**
 * 审核拒绝：标记 rejected、下架、并物理删除源文件。
 *
 * 删文件是「减少空间占有」的落点。image_key 字符串**保留在库里**（spec §11.4）：
 * image_key 是 NOT NULL，改它要放宽约束或存 ''（而 publicUrl('') 会得到一个指向
 * 目录的畸形 URL）；留着这个值则是审计线索 —— 站主日后能看出这件作品的文件曾经
 * 叫什么。代价是后台拿到的 imageUrl 指向一个已不存在的文件（画出来是裂图），
 * 降级落在 WorksTab 的 ThumbOrPlaceholder（src/pages/admin/WorksTab.tsx:26）：
 * rejected 的行不渲染 <img>，改显「源文件已删除」。别改回无条件渲染 ——
 * image_key 在这里是审计线索，不是可访问地址。
 */
export async function rejectWork(id: number): Promise<AdminWorkDetail> {
  const row = requireRow(id);
  if (row.status === 'rejected') return toAdminDetail(row);
  // 先删文件再改记录：反过来会在「记录已改、文件删失败」时留下永远无人引用的
  // 孤儿文件，而孤儿文件没有主键可追溯。删失败只 warn 不阻断（removeQuietly），
  // 否则一次磁盘抖动就把这条投稿永远卡在 pending。
  await removeQuietly(row.image_key);
  await removeQuietly(row.thumb_key);
  const now = Date.now();
  runStmt(
    `UPDATE works SET status='rejected', published=0, updated_at=? WHERE id=?`,
    [now, id],
  );
  flushNow();
  return toAdminDetail({ ...row, status: 'rejected', published: 0, updated_at: now });
}

export async function deleteWork(id: number): Promise<void> {
  const row = requireRow(id);
  // 先删文件、再删记录。反过来会在「记录已删、文件删失败」时留下永远无人引用的
  // 孤儿文件，而孤儿文件没有主键可追溯，后续清理无从下手。
  // 文件删失败只 warn 不阻断 —— 记录必须删掉，否则前台会一直显示点开 404 的卡片。
  await removeQuietly(row.image_key);
  await removeQuietly(row.thumb_key);
  // 不需要再清 work_likes：赞数已经并进 works.likes 这一列，删作品即删赞数，
  // 上一轮为那张表补的 DELETE 一并删掉了 —— 表没了，就没有孤儿行可清。
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

/**
 * 点赞指纹用的盐。与 events.ip_hash / sessions.ip_hash **同名不同义**。
 *
 * 那两列字段名带 hash，但实际存的是明文 IP（server/index.ts 的 trackEvent 直接把
 * req.clientIp 传进去），那是统计模块的既有口径，本项目不去动它。
 * 点赞的去重指纹只活在进程内存里、根本不落库，但仍然加盐：
 * 万一哪天被人 dump 进程内存，明文 IP 也不该直接躺在那儿。
 *
 * 关于盐的防护力，别高估它：它挡的是「明文可见」和「拿已知 IP 直接比对」，
 * **挡不住暴力枚举** —— IPv4 空间只有 2^32 ≈ 43 亿。点赞数据的敏感性本来就低，
 * 所以不上 HMAC；盐只当「别让明文 IP 直接可见」的最低成本措施。
 */
const WORKS_IP_SALT = 'https://www.xn--muu023g.xyz/';

/**
 * 点赞指纹：hash(IP + User-Agent + 作品ID + 日期)。
 *
 * **为什么去重要带 User-Agent**：同一 IP 换浏览器、或多个人共用一个出口 IP（公司、
 * 学校、运营商 NAT）时，只按 IP 去重会把他们算成一个人 —— 后一种情况下，真实的
 * 多名访客里只有第一个能点赞，其余人看到的都是「已赞、点不动」。用户明确要求
 * 把 UA 纳入指纹，换取「同一 IP 换浏览器算两个人、多人共用一个 IP 也能各自赞」。
 *
 * **这是一次有意为之的去重放宽**：同 IP 换 UA 可以再赞一次，计数会多加一次。
 * 代价是有人拿脚本轮换 UA 就能刷赞 —— 那正是令牌桶（server/index.ts 的 allowLike）
 * 要挡的东西，不是这里要挡的。计数口径本就是「次数」不是「人数」，前端文案必须
 * 写「N 次点赞」而不是「N 人喜欢」。
 *
 * 日期用 db.isoDay()：**UTC**，与 events / sessions 全仓统一口径，不在这里引入
 * 第二套时区算法。可感知后果是东八区用户本地 00:00–08:00 的赞算作前一天 ——
 * 这是全仓统一口径的既定代价。
 *
 * 分隔符用 \u0000：UA 和 IP 都是外部输入，理论上能构造出互相「借位」的组合
 * （A 的 UA 拼上 B 的 IP 得到同一个串）。NUL 在 HTTP 头里不可能出现，是最省事的
 * 无歧义分隔。
 */
export function likeFingerprint(
  ip: string,
  userAgent: string,
  workId: number,
  now: number = Date.now(),
): string {
  return createHash('sha256')
    .update(`${ip}\u0000${userAgent}\u0000${workId}\u0000${isoDay(now)}:${WORKS_IP_SALT}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * 进程内「今天已赞过」的指纹集合。**每天一个 Set，第二天自动换新**。
 *
 * 为什么从 work_likes 表挪到内存（用户拍板）：
 * - 表里每行只增不减、永不回收，列表查询每次都要对全表 GROUP BY 一次 —— 那才是
 *   「存库查询压力大」的真正来源。现在去重完全不碰 DB，列表也只读 works.likes 一列。
 * - **代价一（已接受）：重启后当天可以再赞。** 去重集合不在磁盘上，进程一起来就是空的。
 * - **代价二：多进程部署时各算各的。** 与令牌桶同样的前提（systemd 单进程），
 *   横向扩展需换 Redis，届时两处一起换。
 *
 * 上限 LIKES_FINGERPRINT_MAX 必须存在：指纹里的 IP 和 UA 都由客户端控制，
 * 「伪造 UA × 伪造 XFF」能让 Set 无限增长 —— 内存被撑爆比 DB 慢严重得多。
 * 触顶时的选择是**整份丢弃**（fail-open）：去重失效、用户可以重复赞，但进程活着。
 * 反过来 fail-closed（拒绝所有新赞）会把一次异常流量变成当天全站不可点赞。
 * 20_000 条/天对个人站是天文数字，真触顶了也说明站点已经不属于「个人站」，
 * 那时更该处理的是入口而不是去重。
 */
export const LIKES_FINGERPRINT_MAX = 20_000;

let seenDay = '';
let seenFingerprints = new Set<string>();

/**
 * 跨天轮转。day 沿用 isoDay（UTC），与全仓其它地方同一口径。
 * 每次读写都调，所以不存在「没人访问时不轮转、第二天第一次访问读到昨天残留」的问题。
 */
function rotateDayIfNeeded(now: number): void {
  const day = isoDay(now);
  if (day !== seenDay) {
    seenDay = day;
    seenFingerprints = new Set();
  }
}

export interface LikeState {
  likes: number;
  liked: boolean;
}

/** 该作品的累计赞数（直读 works.likes 列，无聚合）。不存在返回 0。 */
function likesOf(workId: number): number {
  const rows = queryAll<{ likes: number }>(`SELECT likes FROM works WHERE id = ?`, [workId]);
  return rows[0]?.likes ?? 0;
}

/**
 * 点赞。**同步**执行 —— 不是偷懒，是这版存储模型下异步化没有任何收益：
 *
 * 早期设计里用户提过「后端异步入库」，那时写入是一条 INSERT 进 work_likes 表，
 * 值得考虑排队。这次改成计数列之后，写入是
 * `UPDATE works SET likes = likes + 1 WHERE id = ? RETURNING likes`
 * —— **单条、走主键、无聚合、无索引写放大**，而 sql.js 是纯内存库（真正的落盘
 * 由 flushNow 批量做），成本本来就接近零。异步化反而要付出：丢掉准确的返回计数
 * （前端只能显示自己编的数字）、引入「已返回成功但其实没写进去」的窗口、
 * 以及一个必须自己维护的串行队列。收益为零、风险为正，所以按同步做。
 *
 * 幂等由内存 Set 保证：**同一 fingerprint 当天第二次点赞 liked=false 且计数不变**。
 *
 * 写入顺序值得说明：先 UPDATE、成功之后才登记指纹。反过来的话，给一个不存在的
 * 作品点赞也会往 Set 里塞一条垃圾指纹（永远命中不了任何真实请求），而且当
 * addLike 因为别的原因失败时，去重已经记下了「赞过了」而计数没加 —— 按钮显示已赞
 * 却点不动，是最难排查的一类状态不一致。
 *
 * 注意语义：同一 fingerprint 次日可以再给同一张图点赞，计数会累加 —— 这是「热度」
 * 而非「人数」，前端文案必须是「N 次点赞」而不是「N 人喜欢」。
 */
export function addLike(workId: number, fingerprint: string, now: number = Date.now()): LikeState {
  rotateDayIfNeeded(now);
  if (seenFingerprints.has(fingerprint)) {
    return { likes: likesOf(workId), liked: false };
  }

  const rows = execReturning<{ likes: number }>(
    `UPDATE works SET likes = likes + 1 WHERE id = ? RETURNING likes`,
    [workId]
  );
  // 0 行 = 作品不存在（草稿 / 越界 id）。不登记指纹、不返回虚假赞数，天然无副作用。
  if (rows.length === 0) return { likes: 0, liked: false };

  if (seenFingerprints.size >= LIKES_FINGERPRINT_MAX) seenFingerprints = new Set();
  seenFingerprints.add(fingerprint);
  return { likes: rows[0]?.likes ?? 0, liked: true };
}

/**
 * 只读不改。GET 与 POST 共用它，保证两条路由的口径一致 ——
 * especially 跨天：两边都调 rotateDayIfNeeded，所以不会出现「GET 说已赞、
 * POST 却当新赞」或反过来的口径打架。
 *
 * 可感知后果：day 走 db.isoDay()，**是 UTC**（与 events / sessions 全仓统一口径）。
 * 东八区用户本地 00:00–08:00 的点赞会被算作前一天，所以早上 8 点前他再点一次会被拒，
 * 按钮显示「未点赞」但点不动。这是全仓统一口径的既定代价，不是这里引入的。
 */
export function likeStateOf(
  workId: number,
  fingerprint: string,
  now: number = Date.now(),
): LikeState {
  rotateDayIfNeeded(now);
  return { likes: likesOf(workId), liked: seenFingerprints.has(fingerprint) };
}

// ---- 投稿配额（2026-10-17） ----

/**
 * 每 IP + 每 UA 每天能投几件。
 *
 * 3 件/天对真实用户足够（没人会一天投 9 张图），对磁盘的暴露却有界：
 * 单件成品图 1–5 MB。
 */
export const SUBMISSION_DAILY_LIMIT = 3;

/**
 * 指纹表的上限。指纹里的 IP 和 UA 都由客户端控制，伪造 IP + 轮换 UA 能让 Map
 * 无限增长 —— 内存被撑爆比 DB 慢严重得多。
 */
export const SUBMISSION_QUOTA_MAX = 20_000;

/**
 * 投稿指纹：hash(IP + User-Agent + 日期 + 盐)。
 *
 * 与 likeFingerprint 同一套口径（同一个 WORKS_IP_SALT、同一个 \0 分隔符、同一个
 * isoDay UTC 日期、同样截断 16 位），只是**去掉了作品 ID 那一段** —— 投稿时作品
 * 还不存在。
 *
 * 包含 UA 的后果要认下来：轮换 UA 就能绕过 3 件/天。这是有意的取舍，兜底是审核
 * 本身 —— pending 永远不公开，攻击者投进来的东西站主一眼就能看到并拒绝。
 * 与其把配额做成攻防战，不如让审核队列当最后一道闸。
 */
export function submissionFingerprint(
  ip: string,
  userAgent: string,
  now: number = Date.now(),
): string {
  return createHash('sha256')
    .update(`${ip}\u0000${userAgent}\u0000${isoDay(now)}:${WORKS_IP_SALT}`)
    .digest('hex')
    .slice(0, 16);
}

let quotaDay = '';
let quotaCount = new Map<string, number>();

/**
 * 跨天轮转。与 likeFingerprint 那边的 rotateDayIfNeeded 同一套写法。
 *
 * **它的职责是内存卫生，不是「算对今天用了几件」。** 指纹里已经含 isoDay，
 * 昨天的 key 今天根本不会被查到 —— 所以就算没有这个函数，跨天后的额度一样是对的
 * （两套机制在「行为」上等价，任何一套在就够）。
 *
 * 不轮转的真正后果在别处：旧 key 再也查不到却仍留在 Map 里，Map 于是**跨天单调
 * 增长**。很快就越过 SUBMISSION_QUOTA_MAX，此后每次写入都触发整份丢弃 ——
 * 上限就从「每天 2 万」退化成「进程启动以来累计 2 万」，配额会被反复打穿，
 * 等于上限本身名存实亡。轮转把上限守回**每日**口径，这才是它不可省的原因。
 */
function rotateQuotaIfNeeded(now: number): void {
  const day = isoDay(now);
  if (day === quotaDay) return;
  quotaDay = day;
  quotaCount = new Map();
}

/** 这个指纹今天还能再投几件。0 = 今日额度已用完。只读，不占名额。 */
export function remainingSubmissions(
  ip: string,
  userAgent: string,
  now: number = Date.now(),
): number {
  rotateQuotaIfNeeded(now);
  const used = quotaCount.get(submissionFingerprint(ip, userAgent, now)) ?? 0;
  return Math.max(0, SUBMISSION_DAILY_LIMIT - used);
}

/**
 * 占用一个名额。返回 false = 今日额度已用完，调用方应回 429。
 *
 * **只挂在真正会写库的那一步上**（createSubmission 在参数校验之后调它），
 * 不要挪到参数校验之前：用户把名称打错一个字收到一个 400，不该同时白扣掉
 * 每日 3 件里的 1 件。
 *
 * 触顶时的选择是**整份丢弃**（fail-open）：配额失效、投稿继续，但进程活着。
 * 反过来 fail-closed 会把一次异常流量变成当天全站投不了稿。
 */
export function allowSubmission(
  ip: string,
  userAgent: string,
  now: number = Date.now(),
): boolean {
  rotateQuotaIfNeeded(now);
  if (quotaCount.size > SUBMISSION_QUOTA_MAX) {
    quotaCount = new Map();
  }
  const fp = submissionFingerprint(ip, userAgent, now);
  const used = quotaCount.get(fp) ?? 0;
  if (used >= SUBMISSION_DAILY_LIMIT) return false;
  quotaCount.set(fp, used + 1);
  return true;
}

/**
 * 第一步：占一个 id。
 *
 * **三步的顺序不能换**：参数校验 → 占配额 → 插入。
 * 配额排在参数校验之后，是为了让「名称打错字收到 400」不同时扣掉每日 3 件里的
 * 1 件。这里与点赞接口「令牌桶排在存在性校验之前」相反，因为代价结构不同：
 * 点赞那一步要打 DB，而这一步只多一次纯 JS 的数字校验，真正贵的 5 MB 文件传输
 * 在第二步、已经被上一步消耗的配额和令牌的一次性语义双重挡着。
 *
 * 写成函数内部固定顺序而不是让 HTTP 层安排，也是为了将来新增写路径时
 * 不可能排错。
 */
export function createSubmission(
  raw: unknown,
  client: { ip: string; userAgent: string },
): CreatedSubmission {
  const input = (raw ?? {}) as Record<string, unknown>;

  const title = requireTitle(input.title);
  const boardW = requireCount(input.boardW, '图纸宽度', 1, MAX_BOARD_CELL);
  const boardH = requireCount(input.boardH, '图纸高度', 1, MAX_BOARD_CELL);
  const beanCount = requireCount(input.beanCount, '豆子数量', 1, MAX_BEAN_COUNT);
  const colorCount = requireCount(input.colorCount, '颜色数量', 1, MAX_COLOR_COUNT);
  const estimateMinutes = requireCount(input.estimateMinutes, '预估时间', 0, MAX_ESTIMATE_MINUTES);

  if (!allowSubmission(client.ip, client.userAgent)) {
    throw new SubmissionQuotaError(`今天的投稿次数已用完（每台设备每天 ${SUBMISSION_DAILY_LIMIT} 件），明天再来吧`);
  }

  const now = Date.now();
  const uploadToken = randomBytes(16).toString('hex');
  runStmt(
    `INSERT INTO works
       (title, description, image_key, thumb_key, width, height, bytes,
        published, status, board_w, board_h, bean_count, color_count,
        estimate_minutes, upload_token, created_at, updated_at)
     VALUES (?, '', '', '', 0, 0, 0, 0, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, boardW, boardH, beanCount, colorCount, estimateMinutes, uploadToken, now, now],
  );

  // 必须在 flushNow() 之前读 last_insert_rowid()：db.export() 会把连接的
  // last_insert_rowid 复位成 0（sql.js 实测），先 flush 再查必然查不到行。
  const rows = queryAll<{ id: number }>(`SELECT id FROM works WHERE id = last_insert_rowid()`);
  const id = rows[0]?.id;
  if (id == null) throw new Error('createSubmission: missing after insert');
  flushNow();
  return { id, uploadToken };
}

export interface SubmissionImageInput {
  image: WorkImage;
  thumb?: WorkImage;
  width?: unknown;
  height?: unknown;
}

/**
 * 第二步：把带二维码的成品图挂到这条投稿上。
 *
 * **令牌校验是这里的核心，不能省。** works.id 是 AUTOINCREMENT 整数、完全可猜；
 * 不校验 upload_token 的话，任何人都能 POST /api/public/works/7/image 把一张
 * 任意图片挂到别人的待审记录上 —— 既污染审核队列，又能把别人的投稿换成自己的图。
 * 令牌只在第一步的响应里出现一次（128 位随机值），比对用 === 即可，
 * 不上 timingSafeEqual：猜不中的前提下时序差不构成实际攻击面。
 */
export async function attachSubmissionImage(
  id: number,
  uploadToken: string,
  input: SubmissionImageInput,
): Promise<AdminWorkDetail> {
  const row = rowById(id);
  if (!row) throw new SubmissionInputError('投稿不存在');
  if (row.status !== 'pending') throw new SubmissionInputError('该投稿已处理，无法再上传图片');
  if (!uploadToken || row.upload_token !== uploadToken) throw new SubmissionInputError('上传凭证无效，请重新投稿');
  // 与令牌校验在正常写入路径下等价（下面的 UPDATE 一次改两列），保留是为了让
  // 「图已存在」这个失败原因在错误文案里单独可辨，而不是笼统的「凭证无效」
  if (row.image_key) throw new SubmissionInputError('该投稿已上传过图片');

  const ext = extFor(input.image.mime, 'image');
  if (input.thumb) {
    const thumbExt = extFor(input.thumb.mime, 'thumb');
    if (thumbExt !== '.webp') throw new SubmissionInputError('缩略图必须是 WebP');
  }

  const hex = randomBytes(8).toString('hex');
  const imageKey = `works/${hex}${ext}`;
  // 写成功才赋值的理由：thumb_key 一旦落库就是「这个文件存在」的承诺。写失败还
  // 照记会留下一条指向不存在文件的记录，前台列表永久破图，而后台的「无缩略图」
  // 标记恰好判据是 thumbUrl === imageUrl，永远标不出这种故障。
  let thumbKey = '';

  await storage.put(imageKey, input.image.body, input.image.mime);
  if (input.thumb) {
    const candidate = `works/${hex}-t.webp`;
    try {
      await storage.put(candidate, input.thumb.body, input.thumb.mime);
      thumbKey = candidate;
    } catch (e) {
      // 降级而不是整体失败：没有缩略图是可降级状态（前端会用原图当缩略图）
      console.warn('[works] 缩略图写入失败，降级为无缩略图', e);
    }
  }

  try {
    runStmt(
      `UPDATE works
          SET image_key = ?, thumb_key = ?, bytes = ?, width = ?, height = ?,
              upload_token = '', updated_at = ?
        WHERE id = ?`,
      [
        imageKey, thumbKey, input.image.body.byteLength,
        optionalCount(input.width, MAX_IMAGE_DIM),
        optionalCount(input.height, MAX_IMAGE_DIM),
        Date.now(), id,
      ],
    );
    flushNow();
  } catch (err) {
    // 文件已经落盘，不回收就是一条没有记录、也没有主键可追溯的孤儿文件
    await removeQuietly(imageKey);
    await removeQuietly(thumbKey);
    throw err;
  }

  return toAdminDetail(requireRow(id));
}
