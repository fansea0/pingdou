/**
 * 全站权威域与固定路径。改域名只改这里一处。
 *
 * gen-sitemap.mjs 和 gen-qr.mjs 都从这里读，保证 sitemap 里列的 URL
 * 和二维码里编码的 URL 不可能分叉 —— 两者分叉过一次就足以让整站 SEO 失信。
 *
 * 注意 index.html 的 canonical / og:url 仍是字面量（构建产物入口，没有模板注入），
 * 所以改域名一共要动：site-config.mjs + index.html（canonical/og/twitter）+
 * src/seo.test.ts。
 */
export const SITE_URL = 'https://www.xn--muu023g.xyz/';

export const WORKS_PATH = 'works';

/** 导出图纸右下角二维码编码的内容。长度决定二维码版本，别随便改。 */
export const WORKS_URL = `${SITE_URL}${WORKS_PATH}`;
