import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { LocalDiskDriver, StorageNotFound } from '../../server/storage/localDisk';

let root = '';
let driver: LocalDiskDriver;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'storage-test-'));
  driver = new LocalDiskDriver(root, '/media');
});

afterEach(() => {
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
});

const BODY = Buffer.from('hello-qr');

describe('LocalDiskDriver put/get 往返', () => {
  it('写入后能原样读回', async () => {
    await driver.put('works/aabbccddeeff0011.png', BODY, 'image/png');
    const back = await driver.get('works/aabbccddeeff0011.png');
    expect(back.equals(BODY)).toBe(true);
  });

  it('put 返回 key / 字节数 / contentType', async () => {
    const info = await driver.put('works/aabbccddeeff0011.png', BODY, 'image/png');
    expect(info).toEqual({ key: 'works/aabbccddeeff0011.png', size: 8, contentType: 'image/png' });
  });

  it('put 会自动创建缺失的中间目录', async () => {
    await driver.put('works/deep/nested/aabbccddeeff0011.png', BODY, 'image/png');
    expect(existsSync(join(root, 'works', 'deep', 'nested'))).toBe(true);
  });
});

describe('LocalDiskDriver get 的缺失语义', () => {
  it('读取不存在的 key 抛 StorageNotFound', async () => {
    await expect(driver.get('works/0000000000000000.png')).rejects.toBeInstanceOf(StorageNotFound);
  });

  it('StorageNotFound 带 STORAGE_NOT_FOUND code，便于调用方区分「没有」和「IO 坏了」', async () => {
    const err = await driver.get('works/0000000000000000.png').catch(e => e as StorageNotFound);
    expect((err as StorageNotFound).code).toBe('STORAGE_NOT_FOUND');
  });
});

describe('LocalDiskDriver head', () => {
  it('存在的文件返回 size', async () => {
    await driver.put('works/aabbccddeeff0011.png', BODY, 'image/png');
    const info = await driver.head('works/aabbccddeeff0011.png');
    expect(info?.size).toBe(8);
  });

  it('不存在的文件返回 null 而不是抛错', async () => {
    expect(await driver.head('works/0000000000000000.png')).toBeNull();
  });

  it('目录返回 null', async () => {
    mkdirSync(join(root, 'works'), { recursive: true });
    expect(await driver.head('works')).toBeNull();
  });
});

describe('LocalDiskDriver delete 的幂等性', () => {
  it('删除后文件不存在', async () => {
    await driver.put('works/aabbccddeeff0011.png', BODY, 'image/png');
    await driver.delete('works/aabbccddeeff0011.png');
    expect(existsSync(join(root, 'works', 'aabbccddeeff0011.png'))).toBe(false);
  });

  it('删除不存在的 key 不抛错 —— 清理路径必须幂等', async () => {
    await expect(driver.delete('works/0000000000000000.png')).resolves.toBeUndefined();
  });
});

describe('publicUrl', () => {
  it('拼接 URL 前缀和 key', () => {
    expect(driver.publicUrl('works/aabbccddeeff0011.png')).toBe('/media/works/aabbccddeeff0011.png');
  });

  it('前缀末尾多余的斜杠会被归一', () => {
    const d = new LocalDiskDriver(root, '/media/');
    expect(d.publicUrl('works/a.png')).toBe('/media/works/a.png');
  });
});

describe('路径穿越防护', () => {
  const evil = [
    '../escape.png',
    '../../etc/passwd',
    'works/../../escape.png',
    'works/./../../escape.png',
  ];
  for (const key of evil) {
    it(`拒绝 ${key}`, async () => {
      await expect(driver.put(key, BODY, 'image/png')).rejects.toThrow(/escapes root/);
    });
  }

  it('拒绝绝对路径 key', async () => {
    await expect(driver.put('/etc/passwd', BODY, 'image/png')).rejects.toThrow(/escapes root/);
  });

  it('前缀近似的兄弟目录不算通过 —— <root>-evil/ 必须被拒', async () => {
    // key 必须精确解析到刚建的 <root>-evil 本身。只有这样，裸 startsWith(rootDir)
    // 那种漏拼分隔符的实现才会误判为合法；写成 '../media-evil-x/x.png' 的话，
    // 它解析到 <root 父目录>/media-evil-x，和 <root> 毫无前缀关系，
    // 错误实现同样会拒 —— 用例就成了空转，守不住任何东西。
    const sibling = `${root}-evil`;
    mkdirSync(sibling, { recursive: true });
    try {
      await expect(driver.put(`../${basename(root)}-evil/x.png`, BODY, 'image/png'))
        .rejects.toThrow(/escapes root/);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('get / head / delete 同样受防护，不只是 put', async () => {
    await expect(driver.get('../escape.png')).rejects.toThrow(/escapes root/);
    await expect(driver.head('../escape.png')).rejects.toThrow(/escapes root/);
    await expect(driver.delete('../escape.png')).rejects.toThrow(/escapes root/);
  });
});
