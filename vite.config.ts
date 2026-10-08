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
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts,
  },
});
