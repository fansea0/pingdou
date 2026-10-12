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
 * 只输出首页：站点是单页工具应用，/statics 是登录后的后台，
 * 本来就被 robots.txt 屏蔽，不属于可索引内容。
 *
 * 刻意不写 <changefreq>：百度和 Google 都已不参考这个字段，
 * 留着只会变成一个纯装饰性的错误信号。
 *
 * 权威域写死为 www + punycode，必须与 index.html 的 canonical、
 * robots.txt 的 Sitemap 行保持一致——改域名三处一起改。
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_URL = 'https://www.xn--muu023g.xyz/';

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
</urlset>
`;

writeFileSync(sitemapPath, xml, 'utf8');
console.log(`[gen-sitemap] 已写入 public/sitemap.xml（lastmod=${lastmod}，来源=${source}）`);