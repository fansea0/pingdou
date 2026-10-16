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

export interface WorkDetail extends WorkSummary {
  description: string;
  imageUrl: string;
  bytes: number;
  /** 元数据改动时间。列表不需要它，详情页和后台用得上。 */
  updatedAt: number;
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

// ---- admin ----

/**
 * 后台专用形状：比公开的 WorkDetail 多一个 published。
 *
 * 公开响应刻意不带 published —— 前台只能拿到已上架的作品，这个字段恒为 true，
 * 带上去是废话。后台列表要区分草稿，所以服务端在 /api/admin/works 上单独补了这个字段，
 * 公开契约不变（见 server/works.ts 的 toAdminDetail）。
 */
export interface AdminWorkDetail extends WorkDetail {
  published: boolean;
}

export interface WorkMetaPatch {
  title?: string;
  description?: string;
  published?: boolean;
}

/**
 * 上传作品。缩略图由调用方在浏览器里用 canvas 生成（见 WorksTab），
 * 服务端不装 sharp —— 保持服务端纯 JS 依赖。
 *
 * 缩略图的表单文件名必须叫 thumb.webp：服务端按扩展名校验 mime
 * （server/works.ts 的 thumb must be image/webp），改名会被 400 拒掉。
 */
export async function adminCreateWork(
  file: File,
  opts: {
    thumb?: Blob | null;
    title?: string;
    description?: string;
    published?: boolean;
    width?: number;
    height?: number;
  } = {}
): Promise<AdminWorkDetail> {
  const fd = new FormData();
  fd.append('file', file);
  if (opts.thumb) fd.append('thumb', opts.thumb, 'thumb.webp');
  fd.append('title', opts.title ?? '');
  fd.append('description', opts.description ?? '');
  // 空串 / '0' / 'false' 都算「明确的关」，所以这里必须显式送 0/1，不能省字段
  fd.append('published', opts.published === false ? '0' : '1');
  if (opts.width != null) fd.append('width', String(opts.width));
  if (opts.height != null) fd.append('height', String(opts.height));
  const res = await fetch(`${BASE}/admin/works`, { method: 'POST', body: fd, credentials: 'include' });
  return jsonOrThrow<AdminWorkDetail>(res);
}

export async function adminListWorks(): Promise<AdminWorkDetail[]> {
  const res = await fetch(`${BASE}/admin/works`, { credentials: 'include' });
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
