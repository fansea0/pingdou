# 拼豆图生成器 SEO 第二轮：权威域统一与 sitemap 自动化

> 承接 [`2026-07-16-seo-baseline-design.md`](./2026-07-16-seo-baseline-design.md)。
> 基线那轮把首页 meta / JSON-LD / robots / sitemap 都搭起来了，
> 但线上实测暴露两个问题，都不涉及页面呈现。

## 范围约束

**页面呈现零改动。** 不动 `#seo-fallback` 的内容、不动它的隐藏样式、
不动 `global.css` 和任何 React 组件。本轮只改 SEO 配置层
（meta 标签、robots.txt、sitemap.xml）及其契约测试。

## 问题

审计时间：2026-10-12，针对线上 `xn--muu023g.xyz` 实测。

### P0 · www 未做 301，重复内容

```
https://xn--muu023g.xyz/        -> 200（无跳转）
https://www.xn--muu023g.xyz/    -> 200（无跳转，内容完全相同）
```

两个域名返回同样的页面。canonical 虽然指向其中之一，但百度对
canonical 的执行并不彻底，重复页面会分散权重，严重时触发重复内容判定。

### P1 · sitemap 的 lastmod 是假的

`<lastmod>2026-07-16</lastmod>` 写死，实际最近改动在 10-10/10-11。
百度会拿 lastmod 和它实际抓到的资源时间对比，长期不一致会降低
对 sitemap 的信任。手改又总会忘。

## 决策

### 权威域定为 `https://www.xn--muu023g.xyz/`

即 www + punycode。选 punycode 是因为 XML / HTTP 头里传中文域名容易
踩编码差异，`DEPLOY.md` 里签发证书用的也是这个形式。

canonical / og:url / twitter:url / JSON-LD `@id` / robots `Sitemap` /
sitemap `<loc>` 全部统一到这个字符串，并由一条测试锁住，防止再次漂移。

**代价**：必须配套改 nginx——把裸域 301 到 www，而不是反过来。
这一项在服务器上，代码改不到，见「部署注意事项」。

### sitemap 改为构建时生成

`scripts/gen-sitemap.mjs` 在 `npm run build` 前重写 `public/sitemap.xml`，
`lastmod` 取最近一次 git 提交日期（`git log -1 --format=%cs`），
拿不到 git 时退回当天。提交即更新，永不过期。

同时删掉 `<changefreq>`：百度和 Google 都已不参考这个字段，
留着只是装饰性的错误信号。

### robots 增加 `Disallow: /api/`

纯 JSON 接口，抓取没有内容价值，只消耗抓取预算。

## 已知但本轮不动的

百度抓到的是 SPA 的原始 HTML，正文只有 `#seo-fallback` 里的一个 `h1`、
一句话和备案号（该区块在 React 挂载后被 CSS 隐藏）。

要改善这点只能扩写静态正文并让它可见，那属于页面改造，超出本轮范围。
在不动页面的前提下，可做的补救只有 sitemap + meta，本轮已做完。

## 不变项

- 页面呈现、`#seo-fallback` 内容与隐藏行为、`global.css`、React 组件全部不变
- 图片处理、导出、商品展示、后台鉴权逻辑不变
- 不虚构评价、评分、FAQ 等页面上不存在的内容
- 不承诺搜索排名；本轮只改善抓取、理解、去重与搜索结果展示的技术基础

## 部署注意事项（代码改不到，需在服务器执行）

`/etc/nginx/conf.d/pingdou.conf` 增加 server 块把裸域 301 到 www。
**80 和 443 两个端口都要覆盖**，否则 http://裸域 会先跳 https 再二次跳转：

```nginx
server {
    listen 80;
    server_name xn--muu023g.xyz;
    # ACME 校验路径必须排除，否则证书续期失败
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot-webroot; }
    return 301 https://www.xn--muu023g.xyz$request_uri;
}

server {
    listen 443 ssl http2;
    server_name xn--muu023g.xyz;
    ssl_certificate     /etc/letsencrypt/live/xn--muu023g.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/xn--muu023g.xyz/privkey.pem;
    return 301 https://www.xn--muu023g.xyz$request_uri;
}
```

原有 www 的 server 块保持不动（它现在是正主）。
证书已覆盖两个域名，无需重新签发。

## 验证

- `src/seo.test.ts`：新增 `/api/` 屏蔽断言、sitemap lastmod 格式断言、
  跨文件域名一致性守卫
- `npm test` 277 项全量通过
- `npm run typecheck` 通过
- `npm run build` 通过，`dist/` 中 robots.txt / sitemap.xml 正确