import { describe, it, expect } from 'vitest';
import { matchRoute } from '@/router';

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
