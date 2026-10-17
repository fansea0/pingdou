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
 * updateWorkMeta / replaceWorkImage）全部经 rowById 或列表查询拿到行，
 * 都会带上真值。createWork 插入后回读时 likes 必然是刚写入的默认值 0。
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

/** 后台管理用：含草稿。likes 同公开列表一样直读 works.likes 列。 */
export function listAllWorks(): AdminWorkDetail[] {
  return queryAll<WorkRow>(
    `SELECT w.*
       FROM works w
      ORDER BY w.created_at DESC, w.id DESC`
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
  // 写成功才赋值的理由：thumb_key 一旦落库就是「这个文件存在」的承诺。写失败还照记，
  // 会留下一条指向不存在文件的记录 —— /media/works/<hex>-t.webp 永久 404，前台列表
  // 破图；而后台的「无缩略图」标记恰好判据是 thumbUrl === imageUrl，永远标不出这种故障。
  let thumbKey = '';
  let created: WorkRow[] = [];

  try {
    await storage.put(imageKey, input.image.body, input.image.mime);
    if (input.thumb) {
      const candidate = `works/${hex}-t.webp`;
      try {
        await storage.put(candidate, input.thumb.body, input.thumb.mime);
        thumbKey = candidate;
      } catch (e) {
        // 降级而不是整体失败：没有缩略图是可降级状态（前端会用原图当缩略图），
        // 强行失败反而让用户白传一次大图。降级后 thumb_key 留空，DB 不再声称有那个文件。
        console.warn('[works] 缩略图写入失败，降级为无缩略图', e);
      }
    }

    const now = Date.now();
    // 显式写 status='approved'：这个函数是即将被删除的后台上传路径（spec §5.4，
  // Task 7），在它还在的这几个任务里必须保住「后台上传 = 直接可公开」的行为，
  // 否则既有 20 多条 works 测试会全红。DDL 的默认值是 pending，正是为了不让
  // 「忘了写 status」的行混进公开列表。
    runStmt(
      `INSERT INTO works
         (title, description, image_key, thumb_key, width, height, bytes,
          published, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
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
  // next 连 likes 一起带过去：rowById 已经读到真值，而本函数不碰 likes，
  // 所以「函数开头读到的赞数」到 return 时仍然成立 —— 不需要为 likes 再查一次库。
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
  // 同 createWork：写成功才记 key，写失败就不让 DB 声称文件存在
  let thumbKey = '';

  await storage.put(imageKey, image.body, image.mime);
  if (thumb) {
    const candidate = `works/${hex}-t.webp`;
    try {
      await storage.put(candidate, thumb.body, thumb.mime);
      thumbKey = candidate;
    } catch (e) {
      console.warn('[works] 缩略图写入失败，降级为无缩略图', e);
    }
  }

  // 同上：likes 由 requireRow 带出，本函数不改赞数，直接透传。
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
 * 跨天轮转。每次读写都调，所以不存在「没人投稿时不轮转、第二天第一次投稿读到
 * 昨天残留」的问题。与 likeFingerprint 那边的 rotateDayIfNeeded 同一套写法。
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
