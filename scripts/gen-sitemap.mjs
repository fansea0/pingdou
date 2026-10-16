#!/usr/bin/env node
/**
 * 构建前生成 public/sitemap.xml。
 *
 * 为什么不用手写：sitemap 里的 <lastmod> 如果长期不更新，会和百度实际
 * 抓到的资源时间对不上，属于失真的变更信号，反而会拉低对 sitemap 的信任。
 * 手改又总会忘。这里的 lastmod 取「最近一次 git 提交的日期」，
 * 提交即更新，永不过期；拿不到 git（例如 CI 里只 rsync 了源码）时
 * 退回当天日期。
 *
 * 输出首页 + 作品库列表页。单作品详情页（/works/:id）刻意不进 sitemap：
 * 作品数量随上传实时变动，维护逐条清单的成本高于收益，且本站是纯 SPA，
 * 详情页是客户端渲染，进 sitemap 只会给爬虫一批收录质量差的 URL。
 * 它们靠 /works 里的链接被爬到。
 *
 * 刻意不写 <changefreq>：百度和 Google 都已不参考这个字段，
 * 留着只会变成一个纯装饰性的错误信号。
 *
 * 权威域写死为 www + punycode，必须与 index.html 的 canonical、
 * robots.txt 的 Sitemap 行保持一致——改域名三处一起改
 * （实际字面量只有 scripts/site-config.mjs 一处，其余从这里读）。
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL, WORKS_URL } from './site-config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sitemapPath = path.join(repoRoot, 'public', 'sitemap.xml');

function resolveLastmod() {
  try {
    // %cs = committer date, short format (YYYY-MM-DD)
    const committed = execFileSync('git', ['log', '-1', '--format=%cs'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(committed)) {
      return { date: committed, source: 'git' };
    }
  } catch {
    // 没有 git 或不在仓库里，走下面的兜底
  }

  return { date: new Date().toISOString().slice(0, 10), source: 'now' };
}

const { date: lastmod, source } = resolveLastmod();

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
  <url>
    <loc>${WORKS_URL}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
</urlset>
`;

writeFileSync(sitemapPath, xml, 'utf8');
console.log(`[gen-sitemap] 已写入 public/sitemap.xml（lastmod=${lastmod}，来源=${source}）`);