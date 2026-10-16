#!/usr/bin/env node
/**
 * 构建前生成 public/brand/works-qr.png —— 导出图纸右下角那个二维码。
 *
 * 为什么要预生成而不是运行时编码：前端 bundle 是纯浏览器端的，
 * 为了一张二维码引入编码库不划算。这里在构建期把码算好、写成 PNG，
 * 运行时只做一次 drawImage，和现有的品牌图标走同一条加载链路
 * （ensureWorksQrImage 复用 ensureWatermarkIcon 的缓存 + 超时兜底）。
 *
 * 参数与它的代价：
 *   ECC L        纠错率最低(7%) → 数据位最少 → 模块数最少。15%(M)/25%(Q) 都会升版本。
 *   33 字符 URL  在 L 级下落在 version 3（容量 53）—— version 2 容量只有 32，差 1 个字符。
 *   模块 3px     2px 能再省 44% 面积，但从「相册里已保存的图」里扫容错余量太小。
 *   静区 4 模块  QR 规范下限，不可再省。
 *   → (29 + 2*4) * 3 = 111px 方图
 *
 * 产出会提交进仓库（public/sitemap.xml 同样处理），否则首次 `npm run dev`
 * 不触发 prebuild，导出时会 404。
 *
 * 产出物是 public/ 下的静态资源，Vite 原样拷到 dist/。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WORKS_URL } from './site-config.mjs';

const ERROR_CORRECTION = 'L';
const MODULE_SIZE_PX = 3;
const QUIET_ZONE_MODULES = 4;

/**
 * 期望的二维码版本。URL 一旦变长（换域名、加路径），二维码会自动升版本、
 * 静悄悄把画面撑大。这里做硬失败让 CI 叫出来，逼人确认新版式是否可接受。
 */
const EXPECTED_VERSION = 3;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(repoRoot, 'public', 'brand', 'works-qr.png');

const qr = QRCode.create(WORKS_URL, { errorCorrectionLevel: ERROR_CORRECTION });
if (qr.version !== EXPECTED_VERSION) {
  console.error(
    `[gen-qr] 期望 version ${EXPECTED_VERSION}，实际 ${qr.version}。\n` +
      `        URL "${WORKS_URL}"（${WORKS_URL.length} 字符）已超出该版本容量，二维码会变大。\n` +
      `        请确认新版式仍可接受后，同步更新 EXPECTED_VERSION 和设计文档。`
  );
  process.exit(1);
}

mkdirSync(path.dirname(outPath), { recursive: true });
const buf = await QRCode.toBuffer(WORKS_URL, {
  errorCorrectionLevel: ERROR_CORRECTION,
  margin: QUIET_ZONE_MODULES,
  scale: MODULE_SIZE_PX,
});
writeFileSync(outPath, buf);

const px = (qr.modules.size + 2 * QUIET_ZONE_MODULES) * MODULE_SIZE_PX;
console.log(`[gen-qr] 已写入 public/brand/works-qr.png（version=${qr.version}, ${px}px, → ${WORKS_URL}）`);
