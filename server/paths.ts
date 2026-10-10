import { resolve, join } from 'node:path';

const RAW = process.env.PINGDOU_DATA_DIR;
if (!RAW) {
  throw new Error(
    'PINGDOU_DATA_DIR env var is required (e.g. /var/lib/pingdou)\n' +
    '本地开发：先跑 npm run dev:init；生产部署：见 docs/DEPLOY.md 的「运行时数据管理」一节',
  );
}

const DATA_DIR = resolve(RAW);

export const PATHS = {
  dataDir: DATA_DIR,
  imagesDir: join(DATA_DIR, 'images'),
  dbPath: join(DATA_DIR, 'stats.db'),
} as const;