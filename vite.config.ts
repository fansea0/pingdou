import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 允许通过这些 Host 访问 dev / preview 服务器
// 解决 Vite 5 默认的 DNS rebinding 拦截：
//   "Blocked request. This host (...) is not allowed."
// 浏览器实际发送的是 punycode（xn--muu023g.xyz = 拼豆.xyz），
// 但写上 Unicode 形式作为备注，便于阅读。
const allowedHosts = [
  'localhost',
  '127.0.0.1',
  'xn--muu023g.xyz',       // 拼豆.xyz 的 punycode
  '.xn--muu023g.xyz',      // 覆盖所有子域（如 www.拼豆.xyz）
  '拼豆.xyz',              // 等价 Unicode 形式
  '.拼豆.xyz',
];

// 前端 dev / preview 默认端口固定 5173；后端固定 3000（见 server/index.ts）。
// dev 模式下通过 proxy 把 /api 转发到后端，避免前端写死 origin。
const BACKEND_DEV_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  worker: {
    format: 'es',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts,
    proxy: {
      '/api': {
        target: BACKEND_DEV_URL,
        changeOrigin: false,
      },
      // 本地 dev：商品图存到 PINGDOU_DATA_DIR/images/，前端直接访问 /products/<file>
      // 生产由 nginx `location /products/ { alias ...; }` 直接 serve 文件；
      // 这里把请求转发到后端的 GET /products/:filename 路由，
      // 由后端读盘返回（dev-only 兜底）。
      '/products': {
        target: BACKEND_DEV_URL,
        changeOrigin: false,
      },
      // 作品原图 / 缩略图：生产由 nginx 的**正则** location
      // （`location ~ ^/media/works/(?<file>[0-9a-f]{16}(-t)?\.(png|jpg|webp))$`，
      // alias 必须自带 `$file`，见 docs/nginx-https-setup.md 4.5）直读，
      // 这里转发到后端的 GET /media/works/:filename 兜底路由（dev-only）。
      // 少了这条，dev 下直接访问 /media/works/xxx.png 会被 Vite 的 SPA fallback
      // 兜回 index.html，前端 matchRoute 判成 home —— 用户看到的是整个首页。
      '/media': {
        target: BACKEND_DEV_URL,
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts,
    proxy: {
      '/api': {
        target: BACKEND_DEV_URL,
        changeOrigin: false,
      },
      '/products': {
        target: BACKEND_DEV_URL,
        changeOrigin: false,
      },
      '/media': {
        target: BACKEND_DEV_URL,
        changeOrigin: false,
      },
    },
  },
});
