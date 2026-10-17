import { renderBeadBoard } from './board';
import { renderCompositeFromBoard, watermarkPlacement } from './composite';
import { applyWatermark, ensureWatermarkIcon } from './watermark';
import { SUBMISSION_QR_PX } from './qr';
import type { Palette, PipelineResult } from '@/types';

/**
 * 投稿成品图的格子像素。与 App.tsx 调 exportMulti(32, ...) 的 32 对齐 ——
 * 两边不一样的话，用户会看到「下载的图」和「投的那张」尺寸不一样。
 */
export const SUBMISSION_CELL_PX = 32;

/**
 * 按「当前参数」渲染投稿用的成品图：拼豆板 + 色号标注 + 色卡 + 水印，
 * 底部留出一条 SUBMISSION_QR_PX 高的白带。
 *
 * **直接吃 PipelineResult，不从原图重新采样。** result 就是用户此刻屏幕上看到的
 * 那张图：去背景、简化颜色、紧裁的结果都已经在里面了（见 pipeline.ts 的 process()
 * 里 finalIndices / finalMask 的推导）。重跑一遍采样只会更慢，而且可能与预览有
 * 细微差异 —— 投稿图必须是用户看到的那张。
 *
 * 导出路径（exportMulti）反而要重新采样，因为它支持一次出多个尺寸。
 *
 * **二维码刻意不在这里画**：码的内容依赖作品 id，而 id 只有落库之后才知道。
 * 调用方拿到 canvas 后先 POST 换 id，再用 drawWorksQr 补画（见 SubmitWorkButton）。
 */
export async function renderSubmissionComposite(
  palette: Palette,
  result: PipelineResult,
): Promise<HTMLCanvasElement> {
  const boardCanvas = renderBeadBoard(
    result.indices,
    result.outW,
    result.outH,
    palette,
    { cellPx: SUBMISSION_CELL_PX, fontPx: 12, mask: result.mask },
  );
  const composite = renderCompositeFromBoard(
    boardCanvas,
    result.indices,
    result.outW,
    result.outH,
    palette,
    result.mask,
    { qrBandPx: SUBMISSION_QR_PX },
  );
  // 与 pipeline.ts 里那个私有 drawWatermark 等价的两步：图标是异步资源，
  // 不先 await 就位的话第一张投稿图只会画文字。落位走共享的 watermarkPlacement，
  // 导出路径与投稿路径的水印因此不可能各偏各的（理由见 composite.ts 里的注释）。
  await ensureWatermarkIcon();
  applyWatermark(composite, watermarkPlacement());
  return composite;
}
