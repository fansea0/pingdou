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
  // 作品原图 + 缩略图。与 images/ 平级而不是塞进去：二者生命周期不同 ——
  // images/ 归商品模块所有，media/ 归 StorageDriver 所有，
  // driver 换实现时这个根目录可以整体换掉。
  mediaDir: join(DATA_DIR, 'media'),
  dbPath: join(DATA_DIR, 'stats.db'),
} as const;