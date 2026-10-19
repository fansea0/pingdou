#!/usr/bin/env node
/**
 * 从带纯色背景的品牌图里抠出透明底 IP 图标，输出站点需要的各尺寸。
 *
 * 做法不是"离背景色最近的像素就透明"——那张图背景带渐变和暗角，
 * 单点参考色会在四角留下蓝边。这里用多源 BFS：把四边像素各自当作
 * 背景锚点，向图内泛洪，给每个像素找到"最近的背景锚点"，再用
 * Lab 色差算 alpha。渐变背景因此也能贴合，角色边缘的混色像素则
 * 自然得到 0~1 的过渡，天然带抗锯齿。
 *
 * 用法（brand/bead-source.png 是定稿的品牌原图，1024 见方）：
 *   node scripts/extract-brand-icon.mjs brand/bead-source.png public
 *
 * 换新的品牌原图时，先用 sips 统一转成 PNG 再喂进来：
 *   sips -s format png -Z 1024 new-source.jpg --out brand/bead-source.png
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';

/** 色差低于 LO 判定为纯背景；超过 HI 判定为完全实心，中间线性过渡。 */
const DELTA_LO = 14;
const DELTA_HI = 38;
/** 算色差前先做 3x3 均值：JPEG 噪点能把背景色差顶到 10 以上，不降噪就会糊一层假透明。 */
const BLUR_RADIUS = 1;
/** 包围盒只认足够实的像素，否则残留的半透明雾会把裁剪框撑大。 */
const BBOX_ALPHA = 0.5;
/** 抠完按 alpha 包围盒裁剪，四周留 2% 余量，避免贴边时被容器切到。 */
const PAD_RATIO = 0.02;

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(r, g, b, out, o) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  // sRGB D65 -> XYZ
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

/** 多源 BFS：每个像素继承最近的边界背景色，再按 Lab 差值算 alpha。 */
function extractAlpha(png) {
  const { width: w, height: h } = png;
  const n = w * h;
  const src = boxBlurRGB(png.data, w, h, BLUR_RADIUS);
  const lab = new Float32Array(n * 3);
  const tmp = new Float32Array(3);
  for (let i = 0; i < n; i++) {
    rgbToLab(src[i * 4], src[i * 4 + 1], src[i * 4 + 2], tmp, 0);
    lab[i * 3] = tmp[0];
    lab[i * 3 + 1] = tmp[1];
    lab[i * 3 + 2] = tmp[2];
  }

  // 边界像素全部作为背景锚点（角色居中，不会压到边）。
  const owner = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const push = (i) => {
    if (owner[i] === -1) {
      owner[i] = i;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) {
      const j = i - 1;
      if (owner[j] === -1) {
        owner[j] = owner[i];
        queue[tail++] = j;
      }
    }
    if (x < w - 1) {
      const j = i + 1;
      if (owner[j] === -1) {
        owner[j] = owner[i];
        queue[tail++] = j;
      }
    }
    if (y > 0) {
      const j = i - w;
      if (owner[j] === -1) {
        owner[j] = owner[i];
        queue[tail++] = j;
      }
    }
    if (y < h - 1) {
      const j = i + w;
      if (owner[j] === -1) {
        owner[j] = owner[i];
        queue[tail++] = j;
      }
    }
  }

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = owner[i];
    const dl = lab[i * 3] - lab[a * 3];
    const da = lab[i * 3 + 1] - lab[a * 3 + 1];
    const db = lab[i * 3 + 2] - lab[a * 3 + 2];
    const d = Math.sqrt(dl * dl + da * da + db * db);
    alpha[i] = Math.min(1, Math.max(0, (d - DELTA_LO) / (DELTA_HI - DELTA_LO)));
  }
  return alpha;
}

/** 只对 0<a<1 的过渡带做一次 3x3 均值，去掉抠图常见的锯齿台阶。 */
function smoothAlpha(alpha, w, h) {
  const out = new Float32Array(alpha.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = alpha[i];
      if (a === 0 || a === 1) {
        out[i] = a;
        continue;
      }
      let sum = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          sum += alpha[ny * w + nx];
          cnt++;
        }
      }
      out[i] = sum / cnt;
    }
  }
  return out;
}

/** RGB 通道的方形均值滤波（半径 1），只用于生成判定用的降噪图。 */
function boxBlurRGB(data, w, h, radius) {
  const out = Buffer.alloc(data.length);
  const r = radius;
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let cnt = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            sum += data[(ny * w + nx) * 4 + c];
            cnt++;
          }
        }
        out[(y * w + x) * 4 + c] = Math.round(sum / cnt);
      }
    }
  }
  return out;
}

/** 盒式降采样缩放（预乘 alpha，避免透明边发暗）。 */
function resample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh * 4);
  const rx = sw / dw;
  const ry = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * ry);
    const y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((y + 1) * ry)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * rx);
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((x + 1) * rx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let cnt = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          const sa = src[i + 3] / 255;
          r += src[i] * sa;
          g += src[i + 1] * sa;
          b += src[i + 2] * sa;
          a += sa;
          cnt++;
        }
      }
      const o = (y * dw + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = (a / cnt) * 255;
    }
  }
  return out;
}

function encodePng(rgba, w, h) {
  const png = new PNG({ width: w, height: h });
  // rgba 是 Float32Array（0~255 的浮点值），必须逐通道转成字节；
  // 直接 Buffer.from(rgba.buffer) 拿到的是 float32 的二进制位图，不是颜色。
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.max(0, Math.min(255, Math.round(rgba[i])));
  }
  png.data = buf;
  return PNG.sync.write(png);
}

/** Vista+ 浏览器认 PNG 负载的 ICO，省掉引入 png-to-ico 依赖。 */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dirs = [];
  for (const e of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = e.size >= 256 ? 0 : e.size;
    dir[1] = e.size >= 256 ? 0 : e.size;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(e.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dirs.push(dir);
  }
  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.png)]);
}

const srcPath = process.argv[2];
if (!srcPath) {
  console.error('usage: node scripts/extract-brand-icon.mjs <source.png> [outDir]');
  process.exit(1);
}
const outDir = resolve(process.argv[3] ?? 'public');

const src = PNG.sync.read(readFileSync(srcPath));
const alpha = smoothAlpha(extractAlpha(src), src.width, src.height);

// 诊断：alpha 直方图一眼能看出是不是又抠出了半透明雾。
const hist = new Array(5).fill(0);
for (const a of alpha) hist[Math.min(4, Math.floor(a * 5))]++;
console.log(
  `alpha 分布 0-.2:${hist[0]}  .2-.4:${hist[1]}  .4-.6:${hist[2]}  .6-.8:${hist[3]}  .8-1:${hist[4]}`
);

// 包围盒裁剪：favicon 是正方形，留白按比例给，避免小尺寸下图形被压扁。
let minX = src.width;
let minY = src.height;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < src.height; y++) {
  for (let x = 0; x < src.width; x++) {
    if (alpha[y * src.width + x] >= BBOX_ALPHA) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) throw new Error('没有找到前景像素，抠图失败');
const bw = maxX - minX + 1;
const bh = maxY - minY + 1;
const side = Math.max(bw, bh);
const pad = Math.round(side * PAD_RATIO);
const cx = Math.round((minX + maxX) / 2);
const cy = Math.round((minY + maxY) / 2);
const sq0 = Math.max(0, cx - Math.round(side / 2) - pad);
const sq1 = Math.min(src.width, sq0 + side + pad * 2);
const sq2 = Math.max(0, cy - Math.round(side / 2) - pad);
const sq3 = Math.min(src.height, sq2 + side + pad * 2);
const cropW = sq1 - sq0;
const cropH = sq3 - sq2;

const cropped = new Float32Array(cropW * cropH * 4);
for (let y = 0; y < cropH; y++) {
  for (let x = 0; x < cropW; x++) {
    const si = (y + sq2) * src.width + (x + sq0);
    const di = (y * cropW + x) * 4;
    const di4 = di;
    cropped[di4] = src.data[si * 4];
    cropped[di4 + 1] = src.data[si * 4 + 1];
    cropped[di4 + 2] = src.data[si * 4 + 2];
    cropped[di4 + 3] = alpha[si] * 255;
  }
}

const TARGETS = [
  { name: 'brand/bead-512.png', size: 512 },
  { name: 'brand/bead-256.png', size: 256 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'favicon-16.png', size: 16 },
  { name: 'apple-touch-icon.png', size: 180 },
];

mkdirSync(resolve(outDir, 'brand'), { recursive: true });
const icoEntries = [];
for (const t of TARGETS) {
  // 非方形输入先补成正方形，favicon 才不会被拉伸。
  const square = Math.max(cropW, cropH);
  const padded = new Float32Array(square * square * 4);
  const offX = Math.round((square - cropW) / 2);
  const offY = Math.round((square - cropH) / 2);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const s = (y * cropW + x) * 4;
      const d = ((y + offY) * square + x + offX) * 4;
      padded[d] = cropped[s];
      padded[d + 1] = cropped[s + 1];
      padded[d + 2] = cropped[s + 2];
      padded[d + 3] = cropped[s + 3];
    }
  }
  const scaled = resample(padded, square, square, t.size, t.size);
  const buf = encodePng(scaled, t.size, t.size);
  const p = resolve(outDir, t.name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  console.log(`${t.name}  ${t.size}x${t.size}  ${(buf.length / 1024).toFixed(1)}KB`);
  if (t.size === 32 || t.size === 16) icoEntries.push({ size: t.size, png: buf });
}

const ico = encodeIco(icoEntries);
writeFileSync(resolve(outDir, 'favicon.ico'), ico);
console.log(`favicon.ico  16+32  ${(ico.length / 1024).toFixed(1)}KB`);
console.log(`裁剪框 ${cropW}x${cropH} -> 输出正方形 ${TARGETS[0].size}x${TARGETS[0].size}`);
