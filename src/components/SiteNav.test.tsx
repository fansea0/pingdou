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
});
