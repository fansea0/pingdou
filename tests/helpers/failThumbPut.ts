import { vi } from 'vitest';

type StorageModule = typeof import('../../server/storage/index.js');

/**
 * 把缩略图的 put 换成失败（模拟磁盘满 / 权限问题），原图的 put 仍走真实实现。
 *
 * 只 spy storage 实例上的方法，不 mock 模块：其它用例要的是真实落盘，
 * mock 整个 storage/index.js 会把它们一起废掉。被测模块与这里是同一个 storage
 * 对象引用（同一个模块注册表实例），所以 spy 对它可见。
 *
 * **必须在 freshWorks() 之后调用**：各测试文件用 `vi.resetModules()` 重置模块注册表，
 * 在 reset 之前 import 到的 storage 会是上一个用例留下的**另一个实例**，spy 等于
 * 打在一个没人用的对象上，测试会假绿。
 *
 * 返回还原函数（`spy.mockRestore`），调用方应在 finally 里调它 —— 否则同一个
 * worker 里的后续用例会带着这个 spy 一起跑。
 */
export async function failThumbPut(): Promise<() => void> {
  const { storage } = (await import('../../server/storage/index.js')) as StorageModule;
  const real = storage.put.bind(storage);
  const spy = vi
    .spyOn(storage, 'put')
    .mockImplementation((key: string, body: Buffer, contentType: string) =>
      key.endsWith('-t.webp')
        ? Promise.reject(new Error('disk full (simulated)'))
        : real(key, body, contentType)
    );
  return () => spy.mockRestore();
}
