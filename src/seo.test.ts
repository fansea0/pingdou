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
    const descriptionMatch = indexHtml.match(
      /<meta\s+name="description"\s+content="([^"]+)"\s*\/?\s*>/,
    );
    expect(descriptionMatch).not.toBeNull();
    expect(descriptionMatch?.[1]).toBe(
      '在线上传图片生成拼豆图纸，并提供 MARD 色号对照。',
    );
    expect(indexHtml).toContain('rel="canonical" href="https://拼豆.xyz/"');
    expect(indexHtml).toContain('application/ld+json');
    expect(indexHtml).toContain('拼豆图纸在线生成');

    const jsonLdMatch = indexHtml.match(
      /<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/,
    );
    expect(jsonLdMatch).not.toBeNull();
    const jsonLd = JSON.parse(jsonLdMatch?.[1] ?? '');

    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd['@graph']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@type': 'WebSite',
          url: 'https://拼豆.xyz/',
        }),
        expect.objectContaining({
          '@type': 'WebApplication',
          url: 'https://拼豆.xyz/',
        }),
      ]),
    );
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
