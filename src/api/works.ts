const BASE = '/api';

/**
 * 与 server/works.ts 的 WorkSummary / WorkDetail 一一对应。
 * 两边各定义一份是仓库既有惯例（Product 也一样），改动时必须同步。
 */
export interface WorkSummary {
  id: number;
  title: string;
  thumbUrl: string;
  width: number;
  height: number;
  createdAt: number;
  /**
   * 累计点赞数。注意单位是「次」不是「人」：同 IP 对同一张图每天限一次、
   * 且不支持取消，同一个人第二天可以再赞，所以人数口径在这里是错的。
   * UI 文案只能写「N 次点赞」。
   */
  likes: number;
}

/**
 * 与 server/works.ts 的 WorkDetail 一一对应（两边各定义一份是仓库既有惯例）。
 *
 * 图纸参数只进 detail 不进 summary：列表页每张卡片只有标题和缩略图，
 * 而后台审核队列恰恰要一眼看到「87 × 62、3814 颗」，所以这五个字段在
 * 后台列表里也得带着（后台用的是 AdminWorkDetail，本就 extends 它）。
 */
export interface WorkDetail extends WorkSummary {
  description: string;
  imageUrl: string;
  bytes: number;
  /** 元数据改动时间。列表不需要它，详情页和后台用得上。 */
  updatedAt: number;
  /** 图纸宽度，单位格。与 boardH 一起构成「87 × 62」。 */
  boardW: number;
  boardH: number;
  /** 实际画出的豆子数（已扣掉被去掉的背景格）。 */
  beanCount: number;
  /** 图纸用到的色号种数。 */
  colorCount: number;
  /** 预估装配工时，单位分钟。展示层再格式化，不存文案。 */
  estimateMinutes: number;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      // body 不是 JSON（很可能是 nginx/proxy 兜底页面），保留状态码原文
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/**
 * 排序方式白名单。非法值由服务端回落 latest，前端不做第三种可能 ——
 * 类型层先掐死，避免 UI 传出一个服务端不认识的值再靠兜底救。
 *
 * 注意：latest 与 hot 都是「本次响应定死」的顺序，点赞只改 likes 数字，
 * 前端任何时候都不许按 likes 重排 items（见设计文档 §4.2）。
 */
export type WorkSort = 'latest' | 'hot';

export async function listWorks(
  limit = 20,
  offset = 0,
  opts: { q?: string; sort?: WorkSort } = {}
): Promise<{ items: WorkSummary[]; total: number }> {
  // q 为空串时不拼：URL 里留一个裸 q= 没意义，还让后端多解析一次
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (opts.q) params.set('q', opts.q);
  // latest 是默认值，不进 query —— 不传 opts 时 URL 与改造前完全一致
  if (opts.sort && opts.sort !== 'latest') params.set('sort', opts.sort);
  const res = await fetch(`${BASE}/public/works?${params.toString()}`, {
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

export async function fetchWork(id: number): Promise<WorkDetail> {
  const res = await fetch(`${BASE}/public/works/${id}`, { credentials: 'include' });
  return jsonOrThrow(res);
}

/**
 * 点赞。服务端按「每 IP 每图每天一次」幂等：重复点不会重复计数，
 * alreadyLiked 告知这次是真赞上了还是今天已经赞过。
 *
 * likes 是「次」不是「人」，见 WorkSummary.likes 的注释。
 */
export async function likeWork(
  id: number
): Promise<{ ok: true; likes: number; alreadyLiked: boolean }> {
  const res = await fetch(`${BASE}/public/works/${id}/like`, {
    method: 'POST',
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

/** 只读点赞状态。用于页面挂载时恢复「我今天赞过没」，不产生写入。 */
export async function fetchLikeState(id: number): Promise<{ likes: number; liked: boolean }> {
  const res = await fetch(`${BASE}/public/works/${id}/like`, { credentials: 'include' });
  return jsonOrThrow(res);
}

// ---- 投稿（公开，免登录） ----

export interface SubmissionInput {
  title: string;
  boardW: number;
  boardH: number;
  beanCount: number;
  colorCount: number;
  estimateMinutes: number;
}

/**
 * 投稿第一步：占一个 id。
 *
 * 拿到的 uploadToken 只在第二步要用一次，服务端不持久化它给任何人看。
 */
export async function createWorkSubmission(
  input: SubmissionInput,
): Promise<{ id: number; uploadToken: string }> {
  const res = await fetch(`${BASE}/public/works`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

/**
 * 投稿第二步：上传按当前参数渲染出来的带码成品图。
 *
 * 尺寸从 canvas 上读 —— 服务端不装 sharp，没法自己从 PNG 里解析。
 * 缩略图可选：传 null 时服务端会把 thumb_key 留空，前台降级用原图当缩略图。
 *
 * 刻意不设 Content-Type：boundary 得由 fetch 自己生成，手写头会把边界抹掉，
 * 服务端 multer 解析不出文件（这条由测试里「init.headers 为 undefined」钉住）。
 */
export async function uploadSubmissionImage(
  id: number,
  uploadToken: string,
  image: Blob,
  opts: { thumb?: Blob | null; width?: number; height?: number } = {},
): Promise<{ ok: true; id: number }> {
  const fd = new FormData();
  fd.append('uploadToken', uploadToken);
  // 文件名是装饰性的：后台上传通道在 Task 7 拆掉之后，服务端改成按 part 的
  // mime 判类型（server/index.ts 的 fileFilter 看 mimetype），不再看 originalname。
  fd.append('image', image, 'image.png');
  if (opts.thumb) fd.append('thumb', opts.thumb, 'thumb.webp');
  if (opts.width != null) fd.append('width', String(opts.width));
  if (opts.height != null) fd.append('height', String(opts.height));
  const res = await fetch(`${BASE}/public/works/${id}/image`, {
    method: 'POST',
    body: fd,
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

// ---- admin ----

/**
 * 后台专用形状：比公开的 WorkDetail 多一个 published 与一个审核态。
 *
 * 公开响应刻意不带这两个字段 —— 前台只能拿到已上架的作品，published 恒为 true，
 * status 也恒为 approved，带上去是废话。后台列表要区分草稿与待审，所以服务端在
 * /api/admin/works 上单独补了它们，公开契约不变（见 server/works.ts 的 toAdminDetail）。
 */
export interface AdminWorkDetail extends WorkDetail {
  published: boolean;
  /** 审核态。与 published 同样只出现在后台形状里。 */
  status: WorkStatus;
}

export type WorkStatus = 'pending' | 'approved' | 'rejected';

export interface WorkMetaPatch {
  title?: string;
  description?: string;
  published?: boolean;
}

/** 后台作品列表。status 不传就是全部（与改动前行为一致）。 */
export async function adminListWorks(
  status?: WorkStatus,
): Promise<AdminWorkDetail[]> {
  const suffix = status ? `?status=${status}` : '';
  const res = await fetch(`${BASE}/admin/works${suffix}`, { credentials: 'include' });
  return jsonOrThrow<AdminWorkDetail[]>(res);
}

export async function adminUpdateWork(id: number, patch: WorkMetaPatch): Promise<AdminWorkDetail> {
  const res = await fetch(`${BASE}/admin/works/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    credentials: 'include',
  });
  return jsonOrThrow<AdminWorkDetail>(res);
}

export async function adminDeleteWork(id: number): Promise<{ ok: true }> {
  const res = await fetch(`${BASE}/admin/works/${id}`, { method: 'DELETE', credentials: 'include' });
  return jsonOrThrow(res);
}

export async function adminApproveWork(id: number): Promise<AdminWorkDetail> {
  const res = await fetch(`${BASE}/admin/works/${id}/approve`, {
    method: 'POST', credentials: 'include',
  });
  return jsonOrThrow(res);
}

export async function adminRejectWork(id: number): Promise<AdminWorkDetail> {
  const res = await fetch(`${BASE}/admin/works/${id}/reject`, {
    method: 'POST', credentials: 'include',
  });
  return jsonOrThrow(res);
}
