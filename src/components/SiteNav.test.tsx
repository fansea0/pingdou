import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SiteNav } from './SiteNav';

// vitest runs with globals:false, so RTL's automatic cleanup is not registered.
afterEach(cleanup);

describe('SiteNav', () => {
  it('有两个跳转条目', () => {
    render(<SiteNav current="/works" />);
    expect(screen.getByRole('link', { name: '生成图纸' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '作品库' })).toBeTruthy();
  });

  it('生成图纸指向 /，作品库指向 /works', () => {
    render(<SiteNav current="/works" />);
    expect(screen.getByRole('link', { name: '生成图纸' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: '作品库' }).getAttribute('href')).toBe('/works');
  });

  it('当前页高亮并带 aria-current', () => {
    render(<SiteNav current="/works" />);
    expect(screen.getByRole('link', { name: '作品库' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: '生成图纸' }).getAttribute('aria-current')).toBeNull();
  });

  it('详情页把作品库当作当前页', () => {
    render(<SiteNav current="/works/42" />);
    expect(screen.getByRole('link', { name: '作品库' }).getAttribute('aria-current')).toBe('page');
  });

  it('导航地标带可访问名', () => {
    // Task 7/8 之后站内会有多个 <nav>（作品库页、详情页各自的导航），
    // aria-label 是屏幕阅读器区分它们的唯一依据，删掉这条断言就该红。
    render(<SiteNav current="/" />);
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
  });
});
