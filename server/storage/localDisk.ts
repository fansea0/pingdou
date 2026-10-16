import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { StorageDriver, StoredObjectInfo } from './types.js';

/** key 在存储里查无此项。与「读文件时 IO 报错」区分开，调用方据此决定是否降级。 */
export class StorageNotFound extends Error {
  readonly code = 'STORAGE_NOT_FOUND';
  constructor(key: string) {
    super(`storage: key not found: ${key}`);
    this.name = 'StorageNotFound';
  }
}

export class LocalDiskDriver implements StorageDriver {
  readonly name = 'local-disk';

  private readonly rootDir: string;
  private readonly rootPrefix: string;
  private readonly urlPrefix: string;

  constructor(rootDir: string, urlPrefix: string) {
    this.rootDir = resolve(rootDir);
    // 比较必须用拼过分隔符的 root，否则 "<root>-evil/x.png" 会被 "<root>" 前缀误判为合法
    this.rootPrefix = this.rootDir.endsWith(sep) ? this.rootDir : this.rootDir + sep;
    this.urlPrefix = urlPrefix.replace(/\/+$/, '');
  }

  private resolveKey(key: string): string {
    const full = resolve(this.rootDir, key);
    if (!full.startsWith(this.rootPrefix)) {
      throw new Error(`storage: illegal key escapes root: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObjectInfo> {
    const full = this.resolveKey(key);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer> {
    const full = this.resolveKey(key);
    if (!existsSync(full)) throw new StorageNotFound(key);
    return readFileSync(full);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const full = this.resolveKey(key);
    try {
      const st = statSync(full);
      if (!st.isFile()) return null;
      // 本地盘的 contentType 无处可查（没存 sidecar），当前无调用方依赖它
      return { key, size: st.size, contentType: '' };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolveKey(key);
    try {
      unlinkSync(full);
    } catch (e) {
      // 幂等：删作品时原图和缩略图是两个独立调用，其中一个缺失
      // （比如缩略图当初生成失败过）不该让整个删除流程失败
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  publicUrl(key: string): string {
    return `${this.urlPrefix}/${key}`;
  }
}
