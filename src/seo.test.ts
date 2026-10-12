import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readProjectFile = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8');

// 全站权威域。www + punycode 形式，nginx 必须把裸域 301 到这里，
// 否则 canonical / sitemap 指向的 URL 和实际可访问的 URL 不一致 = 重复内容。
const SITE_URL = 'https://www.xn--muu023g.xyz/';

describe('homepage SEO contract', () => {
  it('publishes the required homepage metadata and structured data', () => {
    const indexHtml = readProjectFile('index.html');
    const document = new DOMParser().parseFromString(indexHtml, 'text/html');

    expect(indexHtml).toContain(
      '<title>拼豆图生成器｜在线生成拼豆图纸与 MARD 色号对照</title>',
    );
    expect(indexHtml).toContain('name="description"');
    const descriptionMeta = document.querySelector('meta[name="description"]');
    expect(descriptionMeta).not.toBeNull();
    expect(descriptionMeta?.getAttribute('content')).toBe(
      '在线上传图片生成拼豆图纸，并提供 MARD 色号对照。',
    );
    expect(indexHtml).toContain(`rel="canonical" href="${SITE_URL}"`);
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
      `${SITE_URL}samples/rabbit.jpg`,
    );
    expect(document.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe(
      '1260',
    );
    expect(document.querySelector('meta[property="og:image:height"]')?.getAttribute('content')).toBe(
      '1258',
    );
    expect(document.querySelector('meta[property="og:image:alt"]')?.getAttribute('content')).toBe(
      '拼豆图生成器示例：兔子拼豆图纸预览',
    );
    expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toBe(
      `${SITE_URL}samples/rabbit.jpg`,
    );
    expect(document.querySelector('meta[name="twitter:url"]')?.getAttribute('content')).toBe(
      SITE_URL,
    );
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
          url: SITE_URL,
        }),
        expect.objectContaining({
          '@type': 'WebApplication',
          url: SITE_URL,
        }),
      ]),
    );
  });

  it('publishes the ICP filing number in both the static HTML and the rendered footer', () => {
    const FILING_NUMBER = '鄂ICP备2026055552号-1';
    const MIIT_FILING_URL = 'https://beian.miit.gov.cn/';

    // 只抓原始 HTML、不执行 JS 的合规核查工具看不到 React 页脚，
    // 所以两处都要有，且编号不能漂移。
    const indexHtml = readProjectFile('index.html');
    expect(indexHtml).toContain(FILING_NUMBER);
    expect(indexHtml).toContain(MIIT_FILING_URL);

    const appTsx = readProjectFile('src/App.tsx');
    expect(appTsx).toContain(FILING_NUMBER);
    expect(appTsx).toContain(MIIT_FILING_URL);

    // 编号下方必须链接工信部备案管理系统（《非经营性互联网信息服务
    // 备案管理办法》第十三条 / 第二十五条）
    const document = new DOMParser().parseFromString(indexHtml, 'text/html');
    const filingLink = document.querySelector(`#seo-fallback a[href="${MIIT_FILING_URL}"]`);
    expect(filingLink?.textContent?.trim()).toBe(FILING_NUMBER);
  });

  it('allows crawling while publishing the sitemap location', () => {
    const robotsTxt = readProjectFile('public/robots.txt');

    expect(robotsTxt).toContain('User-agent: *');
    expect(robotsTxt).toContain('Allow: /');
    expect(robotsTxt).toContain('Disallow: /statics');
    // 纯 JSON 接口，抓取没有内容价值
    expect(robotsTxt).toContain('Disallow: /api/');
    expect(robotsTxt).toContain(`Sitemap: ${SITE_URL}sitemap.xml`);
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
    expect(sitemapDocument.querySelector('urlset > url > loc')?.textContent).toBe(SITE_URL);

    // lastmod 由 scripts/gen-sitemap.mjs 在构建前生成，
    // 取最近一次 git 提交日期，不允许再写死一个会过期的日期。
    const lastmod = sitemapDocument.querySelector('urlset > url > lastmod')?.textContent;
    expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lastmod).not.toBe('2026-07-16');
  });

  it('keeps canonical, Open Graph, JSON-LD, robots and sitemap on one host', () => {
    // 域名一旦漂移，canonical 会指向另一个 URL，nginx 若没同步 301
    // 就会变成重复内容。这条测试是防漂移的护栏。
    const indexHtml = readProjectFile('index.html');
    const document = new DOMParser().parseFromString(indexHtml, 'text/html');
    const jsonLd = JSON.parse(
      document.querySelector('script[type="application/ld+json"]')?.textContent ?? '',
    );

    const urls = [
      document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
      document.querySelector('meta[name="twitter:url"]')?.getAttribute('content'),
      ...jsonLd['@graph'].map((node: { '@id': string }) => node['@id']),
      readProjectFile('public/robots.txt').match(/^Sitemap:\s*(\S+)$/m)?.[1],
      readProjectFile('public/sitemap.xml').match(/<loc>([^<]+)<\/loc>/)?.[1],
    ];

    for (const url of urls) {
      expect(url).toBeDefined();
      expect(url).toMatch(/^https:\/\/www\.xn--muu023g\.xyz\//);
    }
  });
});