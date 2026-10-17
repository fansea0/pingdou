import { describe, it, expect, vi } from 'vitest';
import { renderBeadBoard } from './board';
import {
  DEFAULT_COMPOSITE_OPTIONS,
  renderCompositeFromBoard,
  watermarkPlacement,
} from './composite';
import { applyWatermark } from './watermark';
import { renderSubmissionComposite, SUBMISSION_CELL_PX } from './submission';
import { SUBMISSION_QR_PX } from './qr';
import type { Palette, PipelineResult } from '@/types';

/**
 * 只把被调的入口包成 spy，实现仍走真函数 —— 其余用例拿到的必须是真图。
 * 下面几条要断的都是「接线」：投稿图与下载图长得不一样、水印贴错画布、遮罩
 * 根本没转发，全都不会改变画布尺寸或白带干净那两条断言，所以只能从调用现场取证。
 */
vi.mock('./board', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./board')>();
  return { ...actual, renderBeadBoard: vi.fn(actual.renderBeadBoard) };
});
vi.mock('./composite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./composite')>();
  return { ...actual, renderCompositeFromBoard: vi.fn(actual.renderCompositeFromBoard) };
});
vi.mock('./watermark', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./watermark')>();
  return { ...actual, applyWatermark: vi.fn(actual.applyWatermark) };
});

// id 是色号字符串（annotator 拿它当文字画进格子里），不是索引 —— 写数字会让
// measureText 拿到非字符串直接炸，等于用例根本跑不到断言。
const PALETTE: Palette = [
  { id: 'A01', rgb: [255, 255, 255], name: '白' },
  { id: 'A02', rgb: [255, 0, 0], name: '红' },
];

/** 交替色格；masked 时把 index 1 那颗红豆标成背景 —— 该格于是不再画豆 */
function makeResult(masked = false): PipelineResult {
  const indices = new Uint8Array([0, 1, 1, 0]);
  const mask = new Uint8Array(masked ? [0, 1, 0, 0] : [0, 0, 0, 0]);
  return {
    indices,
    gridSize: 2,
    outW: 2,
    outH: 2,
    sourceW: 2,
    sourceH: 2,
    cropped: false,
    token: 0,
    mask,
    simplifyColors: false,
    colorBudget: 'off',
    colorSimplification: {
      beforeColorCount: 2, afterColorCount: 2, mergedColorCount: 0,
      rareColorCountBefore: 0, rareColorCountAfter: 0,
      minimumColorCountSatisfied: false, budgetLevel: 'off',
      budgetTargetColorCount: 0, budgetSatisfied: true, budgetFidelityLimited: false,
    },
  };
}

/** 画布上非白像素数。遮罩少画一颗豆，这个数就该跟着少。 */
function nonWhiteCount(canvas: HTMLCanvasElement): number {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) n++;
  }
  return n;
}

describe('renderSubmissionComposite', () => {
  it('产出一张有内容、尺寸非零的合成图', async () => {
    const canvas = await renderSubmissionComposite(PALETTE, makeResult());
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it('底部留出 SUBMISSION_QR_PX 高的白带给二维码', async () => {
    const canvas = await renderSubmissionComposite(PALETTE, makeResult());
    // 整条横带扫一遍，而不是只看总高：总高够大只能证明「画布下面还有东西」，
    // 而「下面留着一条全白的带」才证明那块空间是专门给码留的 —— 白带一旦没预留，
    // 落进这条带的会是色卡卡片（#fbfbfc）和图纸，断言立刻变红。
    const band = canvas
      .getContext('2d')!
      .getImageData(0, canvas.height - SUBMISSION_QR_PX, canvas.width, SUBMISSION_QR_PX).data;
    const nonWhite = band.filter((_, i) => i % 4 !== 3 && band[i] !== 255);
    expect(nonWhite).toHaveLength(0);
  });

  it('格子像素与导出一致（32），否则投稿图和下载的图长得不一样', async () => {
    const boardSpy = vi.mocked(renderBeadBoard);
    boardSpy.mockClear();
    await renderSubmissionComposite(PALETTE, makeResult());
    // 真正要守的是接线：常量被谁改成 24 或写死成别的数，用例要跟着变红。
    // 常量本身对不对由下面那句钉住 —— 它与 App.tsx 调 exportMulti(32, ...) 的 32
    // 是同一条跨文件约定，改数值时两处必须一起改。
    expect(boardSpy).toHaveBeenCalledTimes(1);
    expect(boardSpy.mock.calls[0][4]).toMatchObject({ cellPx: SUBMISSION_CELL_PX });
    expect(SUBMISSION_CELL_PX).toBe(32);
  });

  it('贴水印：落在成品画布上，落位与导出路径共用同一份定义', async () => {
    const watermarkSpy = vi.mocked(applyWatermark);
    watermarkSpy.mockClear();
    const canvas = await renderSubmissionComposite(PALETTE, makeResult());
    // 只能从调用现场取证，不能断像素：水印是 fillText 画的，而 tests/setup.ts 的
    // fillText 是空实现，贴之前贴之后非白像素都是 0。删掉贴水印这两行、或把它贴到
    // 错误的画布上，这里是唯一会红的地方。
    expect(watermarkSpy).toHaveBeenCalledTimes(1);
    // 贴的是最终成品图，不是中途的图纸 —— 贴错画布时导出的图就没有水印
    expect(watermarkSpy.mock.calls[0][0]).toBe(canvas);
    // 落位不在这儿另写一份：三条渲染路径共用 watermarkPlacement，改一处即三处同步
    expect(watermarkSpy.mock.calls[0][1]).toEqual(watermarkPlacement());
  });

  it('把遮罩转发给两处渲染：去背景的格子在投稿图上同样不画豆', async () => {
    const boardSpy = vi.mocked(renderBeadBoard);
    const compositeSpy = vi.mocked(renderCompositeFromBoard);
    boardSpy.mockClear();
    compositeSpy.mockClear();
    const result = makeResult(true);
    await renderSubmissionComposite(PALETTE, result);
    // 两处都要转发：图纸层不转发就不画豆，色卡层不转发就会把背景格算进用量里
    expect(boardSpy.mock.calls[0][4]).toMatchObject({ mask: result.mask });
    expect(compositeSpy.mock.calls[0][5]).toBe(result.mask);
    // 端到端再验一次：遮掉一颗红豆，成品图上的非白像素必须真的变少 ——
    // 夹具里 mask 全 0、0 号又是纯白的话，遮罩丢了也看不出来（两重隐形）。
    const masked = await renderSubmissionComposite(PALETTE, makeResult(true));
    const plain = await renderSubmissionComposite(PALETTE, makeResult(false));
    expect(nonWhiteCount(masked)).toBeLessThan(nonWhiteCount(plain));
  });

  it('不画二维码：码依赖作品 id，而 id 落库之后才知道', async () => {
    const canvas = await renderSubmissionComposite(PALETTE, makeResult());
    // 扫的是 drawWorksQr 将来真会占掉的那块矩形（边距与边长都按它自己的公式算，
    // 不是随手挑一个点）：码画上去之前，这块位必须干干净净。随手挑点不行 ——
    // 这个 fixture 的画布右侧有一大片天然的白边，点挑在白边上，白带没了也照样绿。
    const margin = DEFAULT_COMPOSITE_OPTIONS.padding;
    const rect = canvas
      .getContext('2d')!
      .getImageData(
        canvas.width - margin - SUBMISSION_QR_PX,
        canvas.height - margin - SUBMISSION_QR_PX,
        SUBMISSION_QR_PX,
        SUBMISSION_QR_PX,
      ).data;
    const nonWhite = rect.filter((_, i) => i % 4 !== 3 && rect[i] !== 255);
    expect(nonWhite).toHaveLength(0);
  });
});
