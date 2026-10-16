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

export async function listWorks(
  limit = 20,
  offset = 0
): Promise<{ items: WorkSummary[]; total: number }> {
  const res = await fetch(`${BASE}/public/works?limit=${limit}&offset=${offset}`, {
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

export async function fetchWork(id: number): Promise<WorkDetail> {
  const res = await fetch(`${BASE}/public/works/${id}`, { credentials: 'include' });
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
