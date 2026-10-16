import type { WorkSort } from '@/api/works';

/**
 * 站点路由。站里没装 react-router —— 三个路由不值得为它加依赖，
 * 现有 /statics 已经证明 pathname 判断够用。抽成纯函数是为了能单测，
 * 顺便让「什么路径渲染什么」这件事只有一处定义。
 */

export type Route =
  | { name: 'home' }
  | { name: 'works-list' }
  | { name: 'work-detail'; id: number }
  | { name: 'statics' };

/**
 * 去掉末尾斜杠：'/works/' → '/works'。
 * 不把空串补成 '/'：空串（'' / '/' / '//'）走到 matchRoute 末尾也是 home，
 * 这个分支在当前实现里不可观测，留着只是让人以为空串有专门的处理。
 */
function normalize(pathname: string): string {
  return pathname.replace(/\/+$/, '');
}

export function matchRoute(pathname: string): Route {
  const path = normalize(pathname);

  if (path === '/') return { name: 'home' };
  if (path === '/works') return { name: 'works-list' };

  const detail = /^\/works\/(\d+)$/.exec(path);
  if (detail) {
    const id = Number(detail[1]);
    // 正则已保证捕获串全是数字，Number(...) 必然是整数，不必再判 isInteger。
    // id 必须为正：/works/0 不是有效作品，回首页。
    // 前导零不拒绝：/works/007 即作品 7（Number('007') === 7），
    // 回首页只会让手抄到前导零的用户白跑一趟。
    if (id > 0) return { name: 'work-detail', id };
    return { name: 'home' };
  }

  if (path === '/statics' || path.startsWith('/statics/')) return { name: 'statics' };

  return { name: 'home' };
}

export interface ListQuery {
  q: string;
  sort: WorkSort;
}

/**
 * 从 location.search 解析作品库的搜索词与排序。
 *
 * 搜索词进 URL 是产品决策：刷新和分享都能保留。
 *
 * 必须用 URLSearchParams 而不是手工 split('&') + decodeURIComponent：
 * 搜索框那边也是用 URLSearchParams 写 URL 的，而它按
 * application/x-www-form-urlencoded 把空格编码成 '+'（不是 %20）。
 * 只有 URLSearchParams 会把 '+' 还原成空格 —— decodeURIComponent 不会，
 * 那样「粉 色」写出去、读回来就变成「粉+色」，搜不到。
 *
 * 截断到 100 字符是为了和后端 escapeLike 前的 slice 对齐 ——
 * 两边都截才不会让 URL 显示 300 字而后端只搜前 100。
 */
export function parseListQuery(search: string): ListQuery {
  const params = new URLSearchParams(search);
  const rawSort = params.get('sort');
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    // 白名单：任何非 hot 的值都回落 latest，避免后端收到意外值。
    // 不因为非法值报错 —— 分享出去的链接被手改一位就整页报错不划算。
    sort: rawSort === 'hot' ? 'hot' : 'latest',
  };
}
