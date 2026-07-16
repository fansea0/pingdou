import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('homepage SEO contract', () => {
  it('publishes the required homepage metadata and structured data', () => {
    const indexHtml = readProjectFile('index.html');

    expect(indexHtml).toContain(
      '<title>拼豆图生成器｜在线生成拼豆图纸与 MARD 色号对照</title>',
    );
    expect(indexHtml).toContain('name="description"');
    expect(indexHtml).toContain('rel="canonical" href="https://拼豆.xyz/"');
    expect(indexHtml).toContain('application/ld+json');
    expect(indexHtml).toContain('拼豆图纸在线生成');
  });

  it('allows crawling while publishing the sitemap location', () => {
    const robotsTxt = readProjectFile('public/robots.txt');

    expect(robotsTxt).toContain('Disallow: /statics');
    expect(robotsTxt).toContain('Sitemap: https://拼豆.xyz/sitemap.xml');
  });

  it('includes the homepage in the sitemap', () => {
    const sitemapXml = readProjectFile('public/sitemap.xml');

    expect(sitemapXml).toContain('<loc>https://拼豆.xyz/</loc>');
  });
});
