import { PATHS } from '../paths.js';
import { LocalDiskDriver } from './localDisk.js';
import type { StorageDriver } from './types.js';

/**
 * 全站唯一的存储实例。将来换 S3/OSS，改动面就是这个文件 + 新增一个 driver 实现。
 */
export const storage: StorageDriver = new LocalDiskDriver(PATHS.mediaDir, '/media');
