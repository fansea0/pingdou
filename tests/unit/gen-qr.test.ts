import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 仓库是 "type": "module"，__dirname 在 vitest 的 ESM 里不存在，用 import.meta.url 推导。
// 与 src/seo.test.ts 保持同一套写法（注意别写成 new URL('.', import.meta.url)：
// Vite 的 SSR 转换会把它改写掉，运行时直接抛 "The URL must be of scheme file"）。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 读 PNG 的 IHDR 宽高（字节 16..24） */
function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const DEFAULT_SITE_CONFIG =
  "export const SITE_URL = 'https://www.xn--muu023g.xyz/';\n" +
  "export const WORKS_PATH = 'works';\n" +
  "export const WORKS_URL = `${SITE_URL}${WORKS_PATH}`;\n";

/**
 * 把脚本跑在一次性目录里，避免污染真实的 public/brand。
 *
 * ⚠️ 临时目录必须建在仓库内（而不是 os.tmpdir()）：gen-qr.mjs 会
 * `import QRCode from 'qrcode'`，Node 的 ESM 解析靠逐级向上找 node_modules。
 * 放在系统临时目录下会一路找到 / 才停，解析不到仓库里的 qrcode 直接崩。
 */
function runGen(overrides: Record<string, string> = {}) {
  // 先把源文件读进内存，再建临时目录写出去：源脚本不存在时读取直接抛错，
  // 临时目录压根不会被建出来，红阶段不留垃圾。
  // （清理仍由调用方的 finally 负责 —— 产物就在临时目录里，
  //   在 runGen 内部删掉的话，调用方拿到返回时已经读不到 out 了。）
  const genQrSource = readFileSync(join(repoRoot, 'scripts', 'gen-qr.mjs'), 'utf8');
  const siteConfigSource = overrides['site-config.mjs'] ?? DEFAULT_SITE_CONFIG;

  const tmp = mkdtempSync(join(repoRoot, '.tmp-gen-qr-'));
  const scripts = join(tmp, 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'site-config.mjs'), siteConfigSource);
  writeFileSync(join(scripts, 'gen-qr.mjs'), genQrSource);
  // gen-qr.mjs 用 import.meta.url 推导 repoRoot = scripts/ 的上一级，
  // 这里脚本就在 <tmp>/scripts/，推导结果正好是 <tmp>
  const out = join(tmp, 'public', 'brand', 'works-qr.png');
  try {
    execFileSync(process.execPath, [join(scripts, 'gen-qr.mjs')], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return { tmp, out, ok: true as const };
  } catch (e) {
    return { tmp, out, ok: false as const, err: e as any };
  }
}

describe('gen-qr.mjs', () => {
  it('默认 URL 产出 111×111 的 PNG（version 3 + 静区 4 + 模块 3px）', () => {
    const r = runGen();
    try {
      expect(r.ok).toBe(true);
      expect(existsSync(r.out)).toBe(true);
      expect(pngSize(readFileSync(r.out))).toEqual({ width: 111, height: 111 });
    } finally {
      rmSync(r.tmp, { recursive: true, force: true });
    }
  });

  it('URL 变长到超出 version 3 时非零退出（防止静默变成大二维码）', () => {
    const longUrl =
      "export const SITE_URL = 'https://www.xn--muu023g.xyz/';\n" +
      "export const WORKS_PATH = 'works/a-very-long-path-that-pushes-past-version-three-capacity';\n" +
      "export const WORKS_URL = `${SITE_URL}${WORKS_PATH}`;\n";
    const r = runGen({ 'site-config.mjs': longUrl });
    try {
      expect(r.ok).toBe(false);
      expect(String(r.err?.stderr ?? '')).toMatch(/version/i);
      expect(existsSync(r.out)).toBe(false);
    } finally {
      rmSync(r.tmp, { recursive: true, force: true });
    }
  });
});

describe('入库的产物', () => {
  // runGen() 只验了「脚本现在能生成一张 111×111 的码」。真正被 git 跟踪、
  // 直接上线、且首次 `npm run dev`（不触发 prebuild）会被取用的就是这个文件，
  // 必须单独守住：它被手改/误删，或 qrcode 升补丁版本改了编码字节时，
  // 坏产物会静默合入，而 CI 依然全绿。
  it('committed 的 works-qr.png 本身是 111×111', () => {
    const committed = join(repoRoot, 'public', 'brand', 'works-qr.png');
    expect(existsSync(committed)).toBe(true);
    expect(pngSize(readFileSync(committed))).toEqual({ width: 111, height: 111 });
  });
});

describe('site-config.mjs 与 gen-qr 使用同一个 URL', () => {
  // 走 pathToFileURL 而不是 import('../../scripts/site-config.mjs')：
  // 后者是字面量 specifier，tsc 会去找 .mjs 的类型声明（tsconfig 没开 allowJs）而报错。
  const loadSiteConfig = () =>
    import(pathToFileURL(join(repoRoot, 'scripts', 'site-config.mjs')).href);

  it('二维码内容等于 WORKS_URL', async () => {
    const { WORKS_URL } = await loadSiteConfig();
    expect(WORKS_URL).toBe('https://www.xn--muu023g.xyz/works');
    expect(WORKS_URL).toHaveLength(33);
  });

  it('默认配置里的 WORKS_PATH 就是 works', async () => {
    const { WORKS_PATH } = await loadSiteConfig();
    expect(WORKS_PATH).toBe('works');
  });
});
