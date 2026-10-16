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
