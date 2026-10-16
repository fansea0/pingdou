import { describe, it, expect } from 'vitest';
import { matchRoute, parseListQuery } from '@/router';

describe('matchRoute', () => {
  it("首页：'/' 与纯斜杠路径都不落到其他路由", () => {
    // 这里钉的是「这些路径 → home」，不是 normalize 的归一细节：
    // matchRoute 末尾的兜底分支对任何未识别路径都返回 home，
    // 所以 '' 也一定通过。空串因此不写进断言，免得看着像归一逻辑被覆盖了。
    expect(matchRoute('/')).toEqual({ name: 'home' });
    expect(matchRoute('//')).toEqual({ name: 'home' });
    expect(matchRoute('///')).toEqual({ name: 'home' });
  });

  it('作品列表：/works 与 /works/', () => {
    expect(matchRoute('/works')).toEqual({ name: 'works-list' });
    expect(matchRoute('/works/')).toEqual({ name: 'works-list' });
  });

  it('作品详情：/works/<正整数>', () => {
    expect(matchRoute('/works/1')).toEqual({ name: 'work-detail', id: 1 });
    expect(matchRoute('/works/12345')).toEqual({ name: 'work-detail', id: 12345 });
  });

  it('id 为 0 或非数字时回首页，不落到作品详情', () => {
    expect(matchRoute('/works/0')).toEqual({ name: 'home' });
    expect(matchRoute('/works/abc')).toEqual({ name: 'home' });
    expect(matchRoute('/works/-1')).toEqual({ name: 'home' });
    expect(matchRoute('/works/1.5')).toEqual({ name: 'home' });
  });

  it('多级 /works 路径回首页', () => {
    expect(matchRoute('/works/1/extra')).toEqual({ name: 'home' });
  });

  it('statics 及其子路径', () => {
    expect(matchRoute('/statics')).toEqual({ name: 'statics' });
    expect(matchRoute('/statics/')).toEqual({ name: 'statics' });
    expect(matchRoute('/statics/products')).toEqual({ name: 'statics' });
  });

  it('未知路径回首页', () => {
    expect(matchRoute('/nope')).toEqual({ name: 'home' });
    expect(matchRoute('/work')).toEqual({ name: 'home' });
  });

  it('trailing slash 归一后仍能匹配', () => {
    expect(matchRoute('/works/42/')).toEqual({ name: 'work-detail', id: 42 });
  });

  it('id 带前导零按同一个作品处理，不回首页', () => {
    // 与路由实现里那段注释同源：Number('007') === 7，
    // 手抄到前导零的用户不该被弹回首页。
    expect(matchRoute('/works/007')).toEqual({ name: 'work-detail', id: 7 });
    expect(matchRoute('/works/042')).toEqual({ name: 'work-detail', id: 42 });
  });
});

describe('parseListQuery', () => {
  it('空 query 返回默认值', () => {
    expect(parseListQuery('')).toEqual({ q: '', sort: 'latest' });
  });

  it('解析 q', () => {
    expect(parseListQuery('?q=%E5%B0%8F%E7%86%8A')).toEqual({ q: '小熊', sort: 'latest' });
  });

  it('解析 sort=hot', () => {
    expect(parseListQuery('?sort=hot')).toEqual({ q: '', sort: 'hot' });
  });

  it('两者同时解析', () => {
    expect(parseListQuery('?q=%E7%86%8A&sort=hot')).toEqual({ q: '熊', sort: 'hot' });
  });

  it('非法 sort 回落 latest（白名单）', () => {
    expect(parseListQuery('?sort=bogus')).toEqual({ q: '', sort: 'latest' });
    expect(parseListQuery('?sort=LATEST')).toEqual({ q: '', sort: 'latest' });
    // 大小写变体也要盖：排序只有 latest/hot 两个取值，是精确匹配，
    // 不是「忽略大小写的枚举」。写 'HOT' 的人拿到的是默认排序，不是最热。
    expect(parseListQuery('?sort=HOT')).toEqual({ q: '', sort: 'latest' });
    expect(parseListQuery('?sort=Hot')).toEqual({ q: '', sort: 'latest' });
    // 空值同样回落，不要因此报错或给出 undefined。
    expect(parseListQuery('?sort=')).toEqual({ q: '', sort: 'latest' });
  });

  it('q 被截断到 100 字符（与后端上限一致）', () => {
    const long = 'a'.repeat(300);
    expect(parseListQuery(`?q=${long}`).q).toHaveLength(100);
  });

  it('q 的首尾空白被 trim', () => {
    expect(parseListQuery('?q=%20%20%E7%86%8A%20%20')).toEqual({ q: '熊', sort: 'latest' });
  });

  it('多余的参数被忽略', () => {
    expect(parseListQuery('?q=%E7%86%8A&foo=bar&sort=hot')).toEqual({ q: '熊', sort: 'hot' });
  });

  it('缺 q 时给空串而不是 undefined', () => {
    const r = parseListQuery('?sort=hot');
    expect(r.q).toBe('');
  });

  it('q 只剩空白（trim 后为空）等同于没搜', () => {
    // trim 之后是空串，就不要让下游拿到一个「看起来有搜索词」的值。
    expect(parseListQuery('?q=%20%20')).toEqual({ q: '', sort: 'latest' });
  });

  it('URLSearchParams 编码的空格解回空格，而不是字面加号', () => {
    // 这条是 Task 4 评审转交的检查点：搜索框用 URLSearchParams 写 URL 时，
    // 空格会被编码成 '+'（不是 %20）。如果这里改成手工 split('&') + decodeURIComponent，
    // '+' 不会被还原成空格，搜「粉 色」就会变成搜「粉+色」而搜不到。
    // 只有 URLSearchParams 才认 application/x-www-form-urlencoded 的 '+'。
    expect(parseListQuery('?q=%E7%B2%89+%E8%89%B2')).toEqual({ q: '粉 色', sort: 'latest' });
    expect(parseListQuery('?q=粉+色').q).toBe('粉 色');
  });

  it('字面加号本身仍能搜到（写成 %2B 保留加号）', () => {
    // 上一条的反面：'+' 是空格，转义的 %2B 才是真加号。
    // 钉住这条是为了让「改用 decodeURIComponent」这个变异不至于蒙混过关。
    expect(parseListQuery('?q=%E7%B2%89%2B%E8%89%B2').q).toBe('粉+色');
  });

  it('q 缺失与 q 存在但为空，结果一致', () => {
    // '?q=' 这种裸参数必须等同于没搜，否则 URL 里会出现无意义的状态。
    expect(parseListQuery('?q=')).toEqual({ q: '', sort: 'latest' });
  });
});
