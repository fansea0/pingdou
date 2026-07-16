import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readProjectFile = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('homepage SEO contract', () => {
  it('publishes the required homepage metadata and structured data', () => {
    const indexHtml = readProjectFile('index.html');
    const document = new JSDOM(indexHtml).window.document;

    expect(indexHtml).toContain(
      '<title>拼豆图生成器｜在线生成拼豆图纸与 MARD 色号对照</title>',
    );
    expect(indexHtml).toContain('name="description"');
    const descriptionMeta = document.querySelector('meta[name="description"]');
    expect(descriptionMeta).not.toBeNull();
    expect(descriptionMeta?.getAttribute('content')).toBe(
      '在线上传图片生成拼豆图纸，并提供 MARD 色号对照。',
    );
    expect(indexHtml).toContain('rel="canonical" href="https://拼豆.xyz/"');
    expect(indexHtml).toContain('application/ld+json');
    expect(indexHtml).toContain('拼豆图纸在线生成');

    const jsonLdScript = document.querySelector(
      'script[type="application/ld+json"]',
    );
    expect(jsonLdScript).not.toBeNull();
    const jsonLd = JSON.parse(jsonLdScript?.textContent ?? '');

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

    expect(robotsTxt).toContain('User-agent: *');
    expect(robotsTxt).toContain('Allow: /');
    expect(robotsTxt).toContain('Disallow: /statics');
    expect(robotsTxt).toContain('Sitemap: https://拼豆.xyz/sitemap.xml');
    expect(robotsTxt).not.toMatch(/^Disallow:\s*\/\s*(?:#.*)?$/m);
  });

  it('includes the homepage in the sitemap', () => {
    const sitemapXml = readProjectFile('public/sitemap.xml');
    const sitemapDocument = new DOMParser().parseFromString(
      sitemapXml,
      'application/xml',
    );

    expect(sitemapDocument.querySelector('parsererror')).toBeNull();
    expect(sitemapDocument.querySelector('urlset')).not.toBeNull();
    expect(sitemapDocument.querySelector('urlset > url')).not.toBeNull();
    expect(sitemapDocument.querySelector('urlset > url > loc')?.textContent).toBe(
      'https://拼豆.xyz/',
    );
  });
});
