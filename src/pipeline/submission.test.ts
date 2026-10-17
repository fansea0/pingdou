import { describe, it, expect, vi } from 'vitest';
import { renderBeadBoard } from './board';
import { DEFAULT_COMPOSITE_OPTIONS } from './composite';
import { renderSubmissionComposite, SUBMISSION_CELL_PX } from './submission';
import { SUBMISSION_QR_PX } from './qr';
import type { Palette, PipelineResult } from '@/types';

/**
 * 只把 renderBeadBoard 包成 spy，实现仍走真函数 —— 其余用例拿到的必须是真图，
 * 而这条用例要的是「投稿图这条路径真的把 cellPx 接到了图纸渲染上」。
 * 常量比常量（SUBMISSION_CELL_PX === 32）恒真，接线断了也不变红，所以从调用现场取证。
 */
vi.mock('./board', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./board')>();
  return { ...actual, renderBeadBoard: vi.fn(actual.renderBeadBoard) };
});

// id 是色号字符串（annotator 拿它当文字画进格子里），不是索引 —— 写数字会让
// measureText 拿到非字符串直接炸，等于用例根本跑不到断言。
const PALETTE: Palette = [
  { id: 'A01', rgb: [255, 255, 255], name: '白' },
  { id: 'A02', rgb: [255, 0, 0], name: '红' },
];

function makeResult(): PipelineResult {
  return {
    indices: new Uint8Array([0, 1, 1, 0]),
    gridSize: 2,
    outW: 2,
    outH: 2,
    sourceW: 2,
    sourceH: 2,
    cropped: false,
    token: 0,
    mask: new Uint8Array([0, 0, 0, 0]),
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
