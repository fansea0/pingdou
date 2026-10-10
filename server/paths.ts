import { resolve, join } from 'node:path';

// 运行时数据根目录。生产环境（systemd / 部署脚本）通常显式注入；
// 本地开发 / 临时启动不设时，fallback 到 /var/lib/pingdou，
// 由 imagesDir + dbPath 派生 images/ 和 stats.db。
const DEFAULT_DATA_DIR = '/var/lib/pingdou';
const RAW = process.env.PINGDOU_DATA_DIR?.trim() || DEFAULT_DATA_DIR;
const DATA_DIR = resolve(RAW);

export const PATHS = {
  dataDir: DATA_DIR,
  imagesDir: join(DATA_DIR, 'images'),
  dbPath: join(DATA_DIR, 'stats.db'),
} as const;