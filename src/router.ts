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
