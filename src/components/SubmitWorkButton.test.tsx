import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { SubmitWorkButton } from './SubmitWorkButton';
import type { Palette, PipelineResult } from '@/types';

const renderComposite = vi.fn();
const renderQr = vi.fn();
const drawQr = vi.fn();
const toBlobMock = vi.fn();
const createSubmission = vi.fn();
const uploadImage = vi.fn();

// 统一用仓库既有的 vi.mock + importActual 范式（见 LikeButton.test.tsx /
// WorkDetailPage.test.tsx）。drawWorksQr 也要 mock：本仓库的 canvas 桩
// fillText 是空实现、像素采样又受白边干扰，「码画在了哪张画布上」只能靠
// 「传给了谁」来断，不能靠看像素（见下面「码画在刚渲染那张上」那条用例）。
vi.mock('@/pipeline/submission', async () => {
  const actual = await vi.importActual<typeof import('@/pipeline/submission')>('@/pipeline/submission');
  return { ...actual, renderSubmissionComposite: (...a: unknown[]) => renderComposite(...a) };
});

vi.mock('@/pipeline/qr', async () => {
  const actual = await vi.importActual<typeof import('@/pipeline/qr')>('@/pipeline/qr');
  return {
    ...actual,
    renderSubmissionQr: (...a: unknown[]) => renderQr(...a),
    drawWorksQr: (...a: unknown[]) => drawQr(...a),
  };
});

// jsdom 没有 canvas.toBlob，不 mock 的话 canvasToBlob 会 reject，整个流程走不到上传那步。
// makeThumb 内部同样调 toBlob，但它包在 try/catch 里降级返回 null，不影响本组用例
// —— 也就是说本组用例永远跑不到缩略图的真实逻辑，缩略图路径在这里是未覆盖的。
vi.mock('@/pipeline/exporter', async () => {
  const actual = await vi.importActual<typeof import('@/pipeline/exporter')>('@/pipeline/exporter');
  return { ...actual, canvasToBlob: (...a: unknown[]) => toBlobMock(...a) };
});

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return {
    ...actual,
    createWorkSubmission: (...a: unknown[]) => createSubmission(...a),
    uploadSubmissionImage: (...a: unknown[]) => uploadImage(...a),
  };
});

// id 必须是字符串色号：PaletteEntry.id 是 string，annotator 还要把它喂给
// ctx.measureText，数字会直接抛「text is not iterable」。
const PALETTE: Palette = [{ id: 'A01', rgb: [1, 2, 3], name: '黑' }];

const RESULT: PipelineResult = {
  indices: new Uint8Array([0]),
  gridSize: 1, outW: 1, outH: 1, sourceW: 1, sourceH: 1,
  cropped: false, token: 0, mask: new Uint8Array([0]),
  simplifyColors: false, colorBudget: 'off',
  colorSimplification: {
    beforeColorCount: 1, afterColorCount: 1, mergedColorCount: 0,
    rareColorCountBefore: 0, rareColorCountAfter: 0,
    minimumColorCountSatisfied: false, budgetLevel: 'off',
    budgetTargetColorCount: 0, budgetSatisfied: true, budgetFidelityLimited: false,
  },
};

/** 造一张有真实尺寸的 canvas：组件要读 canvas.width/height 当图片尺寸传给服务端 */
function fakeCanvas(w = 400, h = 600): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** renderSubmissionQr 的返回替身：drawWorksQr 只读 naturalWidth，够用 */
function fakeQrImage(): HTMLImageElement {
  return { naturalWidth: 111 } as unknown as HTMLImageElement;
}

// jsdom 的 HTMLCanvasElement.toBlob 是「未实现」桩：它既不报错也不回调，于是
// makeThumb 里 await 的 Promise 永远不 settle，整个 Promise.all 挂住 —— 连
// uploadSubmissionImage 都走不到。try/catch 救不了这种「不 settle」，只有补桩能。
//
// toBlobType 模拟「这个浏览器支不支持 WebP 编码」：桩不看请求的类型，只按
// toBlobType 回 Blob。支持就回 webp（makeThumb 正常出缩略图），不支持就静默
// 回落成 image/png（HTML 规范要求的行为，也正是 makeThumb 专门验 mime 的原因）。
const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
let toBlobType = 'image/webp';
beforeEach(() => {
  toBlobType = 'image/webp';
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb, _type) {
    cb(new Blob(['x'], { type: toBlobType }));
  };
  renderComposite.mockReset().mockResolvedValue(fakeCanvas());
  renderQr.mockReset().mockResolvedValue(null);
  drawQr.mockReset();
  toBlobMock.mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  createSubmission.mockReset().mockResolvedValue({ id: 42, uploadToken: 'tok' });
  uploadImage.mockReset().mockResolvedValue({ ok: true, id: 42 });
});

// vitest.config.ts 是 globals:false，RTL 的自动 cleanup 不注册。少了这行 DOM 会
// 跨用例残留，实现完全正确也会红（既有测试注释里记着同一个坑）。
afterEach(cleanup);

afterEach(() => {
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.toBlob = nativeToBlob;
});

/**
 * 按 App.tsx 的真实接线包一层：触发器在导出面板里，本组件只吃受控的 open。
 * 直接 render 本组件的话没有按钮可点，下面那些「点开弹窗」的用例全都无从下手。
 */
let lastSetOpen: ((open: boolean) => void) | null = null;

function Harness(over: Partial<ComponentProps<typeof SubmitWorkButton>>) {
  const [open, setOpen] = useState(false);
  lastSetOpen = setOpen;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>投稿到作品库</button>
      <SubmitWorkButton
        palette={PALETTE}
        result={RESULT}
        beanCount={3814}
        colorCount={42}
        estimateLabel="约 6.4 小时"
        estimateMinutes={384}
        {...over}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function renderButton(over: Partial<ComponentProps<typeof SubmitWorkButton>> = {}) {
  lastSetOpen = null;
  const r = render(<Harness {...over} />);
  /** 直接开窗，绕开触发器 —— 用来测「被挡住时开不起来」这类分支 */
  return { ...r, openDialog: (v: boolean) => act(() => lastSetOpen?.(v)) };
}

/**
 * 点开弹窗、填名称、确认，把三步公共动作收在一处。
 *
 * 触发按钮用完整文案而不是 /投稿/ 模糊匹配：弹窗一打开，「确认投稿」也命中同一个
 * 正则，getByRole 会因为命中两个而抛错。
 */
function submitWith(title: string) {
  fireEvent.click(screen.getByRole('button', { name: '投稿到作品库' }));
  fireEvent.change(screen.getByLabelText(/名称/), { target: { value: title } });
  fireEvent.click(screen.getByRole('button', { name: /确认投稿/ }));
}

describe('SubmitWorkButton', () => {
  // 触发器搬到导出面板之后，本组件不再有按钮可以置灰，挡住的责任落在这条：
  // 外面把 open 设成 true，本组件必须自己把窗收掉。少了它，用户能对着一张
  // 没有豆子的图点进一个永远填不完的弹窗，白占一次当天配额。
  it('没有图纸时即使被要求打开，弹窗也开不起来', () => {
    const { openDialog } = renderButton({ result: null });
    openDialog(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('豆子数为 0 时同样开不起来：整张图被去背景吃掉，投稿只剩一张空板', () => {
    // 判别力：把 blocked 里的 beanCount <= 0 删掉时，本条与「没有图纸」那条
    // 都仍绿，但用户能投出一张没有豆子的图并消耗当天配额。
    const { openDialog } = renderButton({ beanCount: 0 });
    openDialog(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('先开着窗、随后变成没有图纸时，窗会被收掉', () => {
    // 只测「一开始就 blocked」不够：导出面板的 disabled 可能在投稿进行途中
    // 才变（用户重新上传了图、或 pipeline 回到 idle），那时窗已经开着了。
    const { openDialog, rerender } = renderButton();
    openDialog(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
    rerender(<Harness result={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('点击后弹窗显示名称输入框与四个参数的只读摘要', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('1 × 1 格');
    expect(dialog.textContent).toContain('3,814 颗');
    expect(dialog.textContent).toContain('42 种');
    expect(dialog.textContent).toContain('约 6.4 小时');
  });

  it('没有预估文案时摘要那一格兜底成「—」，不露出 null', () => {
    renderButton({ estimateLabel: null });
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    // 断「—」而不是 not.toContain('null')：兜底被改成空串时后者照样绿。
    expect(screen.getByRole('dialog').textContent).toContain('—');
  });

  it('名称为空时不能提交，也不发任何请求', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: '   ' } });

    const confirm = screen.getByRole('button', { name: /确认投稿/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    // 必须等一拍再断言：submit 里的链第一步就是 await renderSubmissionComposite，
    // 同步断言时它还没 resolve，createSubmission 不被调用是「还没轮到」而不是
    // 「被挡住了」—— 整条链删光也照样绿。
    await new Promise((r) => setTimeout(r, 0));
    expect(createSubmission).not.toHaveBeenCalled();
    expect(renderComposite).not.toHaveBeenCalled();
    // 真正兜住这条不变量的是上面那个 disabled 属性：React 是按 fiber 上的
    // props.disabled 决定要不要派发 onClick 的（不是读 DOM 的 disabled），所以
    // 确认键一旦 disabled，点不动 —— submit 开头那个 `if (!name…)` 属于
    // 兜底的兜底，单独删它观察不到（实测：只删它，本文件仍全绿）。
  });

  it('点取消只关弹窗，不发任何请求', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: '不投了' } });
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(createSubmission).not.toHaveBeenCalled();
    expect(renderComposite).not.toHaveBeenCalled();
  });

  it('确认后先渲染成品图，再 POST 元数据，补画码，最后上传带码图', async () => {
    const order: string[] = [];
    renderComposite.mockImplementation(async () => { order.push('render'); return fakeCanvas(); });
    renderQr.mockImplementation(async () => { order.push('qr'); return null; });
    createSubmission.mockImplementation(async () => { order.push('create'); return { id: 42, uploadToken: 'tok' }; });
    uploadImage.mockImplementation(async () => { order.push('upload'); return { ok: true, id: 42 }; });

    renderButton();
    submitWith('粉色小熊');

    await waitFor(() => expect(order).toEqual(['render', 'create', 'qr', 'upload']));
  });

  it('码画在刚渲染出来的那张 canvas 上，且用的就是那张码', async () => {
    const canvas = fakeCanvas();
    const qrImage = fakeQrImage();
    renderComposite.mockResolvedValue(canvas);
    renderQr.mockResolvedValue(qrImage);

    renderButton();
    submitWith('x');

    await waitFor(() => expect(drawQr).toHaveBeenCalled());
    // 判别力：drawWorksQr 只拿 canvas 当落点，参数传错（画到别的画布、
    // 或用错那张码）时上面那条时序用例仍然全绿。
    expect(drawQr).toHaveBeenCalledWith(canvas, qrImage);
    // 画码必须发生在 encode 之后、导出之前：码要等 id，而导出拿的是画完码的图。
    expect(renderQr.mock.invocationCallOrder[0]).toBeLessThan(toBlobMock.mock.invocationCallOrder[0]);
    expect(drawQr.mock.invocationCallOrder[0]).toBeLessThan(toBlobMock.mock.invocationCallOrder[0]);
  });

  it('码生成失败降级：照样上传，只是不画码', async () => {
    renderQr.mockResolvedValue(null);
    renderButton();
    submitWith('x');

    await waitFor(() => expect(uploadImage).toHaveBeenCalled());
    expect(drawQr).not.toHaveBeenCalled();
  });

  it('POST 元数据时带上四个图纸参数与分钟数（不是那句「约 6.4 小时」的文案）', async () => {
    renderButton();
    submitWith('x');

    await waitFor(() => expect(createSubmission).toHaveBeenCalledWith({
      title: 'x',
      boardW: 1, boardH: 1,
      beanCount: 3814, colorCount: 42, estimateMinutes: 384,
    }));
  });

  it('上传时把 canvas 的真实尺寸一并传给服务端（详情页要靠它显示成品尺寸）', async () => {
    renderComposite.mockResolvedValue(fakeCanvas(1234, 5678));
    renderButton();
    submitWith('x');

    await waitFor(() => expect(uploadImage).toHaveBeenCalled());
    const [, , , opts] = uploadImage.mock.calls[0] as unknown as [
      number, string, Blob, { width: number; height: number },
    ];
    expect(opts.width).toBe(1234);
    expect(opts.height).toBe(5678);
  });

  it('浏览器不支持 WebP 时缩略图降级成 null，不把 PNG 当缩略图传上去', async () => {
    // 契约：opts.thumb 必须是 null。把 PNG 当缩略图传上去的话，服务端按 mime
    // 判类型直接 400，整次投稿连带原图一起失败 —— 比没有缩略图糟得多。
    toBlobType = 'image/png';
    renderButton();
    submitWith('x');

    await waitFor(() => expect(uploadImage).toHaveBeenCalled());
    const [, , , opts] = uploadImage.mock.calls[0] as unknown as [
      number, string, Blob, { thumb: Blob | null },
    ];
    expect(opts.thumb).toBeNull();
  });

  it('支持 WebP 时把缩略图连同原图尺寸一起传上去', async () => {
    // 判别力：把 thumb 一律写死成 null 时，上面那条照样绿、这条会红。
    // （缩略图的缩放与编码本身仍由浏览器完成，jsdom 这里只到 mime 校验为止。）
    renderButton();
    submitWith('x');

    await waitFor(() => expect(uploadImage).toHaveBeenCalled());
    const [, , , opts] = uploadImage.mock.calls[0] as unknown as [
      number, string, Blob, { thumb: Blob | null },
    ];
    expect(opts.thumb).toBeInstanceOf(Blob);
    expect(opts.thumb?.type).toBe('image/webp');
  });

  it('成功后提示「等审核」而不是给出链接（还没过审，链接不可访问）', async () => {
    renderButton();
    submitWith('x');

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('审核'));
    expect(screen.getByRole('status').textContent).not.toContain('/works/42');
  });

  it('上传失败给中文错误，不吞异常', async () => {
    uploadImage.mockRejectedValue(new Error('上传失败了，稍后再试'));
    renderButton();
    submitWith('x');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('上传失败了'),
    );
  });

  it('配额在第一步就被扣掉：占 id 失败时第二步不会发生，错误提示仍看得见', async () => {
    // 配额校验在 createSubmission 的第一步就返回 429（服务端顺序：校验 → 占配额
    // → 插入），uploadImage 压根不会被调。此时弹窗已经关掉了，错误如果只渲染在
    // 弹窗里用户就是「点了没反应也没提示」。
    createSubmission.mockRejectedValue(new Error('今天的投稿次数已用完，明天再来吧'));
    renderButton();
    submitWith('x');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('今天的投稿次数已用完'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('失败后可以改名字重投，且不会把上一次的错误带进新弹窗', async () => {
    createSubmission.mockRejectedValueOnce(new Error('网络炸了'));
    renderButton();
    submitWith('第一版');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络炸了'));

    fireEvent.click(screen.getByRole('button', { name: /投稿/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    submitWith('第二版');
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(2));
    expect(createSubmission.mock.calls[1][0]).toMatchObject({ title: '第二版' });
  });

  it('投稿进行中禁用重复点击', async () => {
    let resolveCreate: (v: { id: number; uploadToken: string }) => void = () => {};
    createSubmission.mockImplementation(
      () => new Promise((r) => { resolveCreate = r as typeof resolveCreate; }),
    );
    renderButton();
    submitWith('x');

    // 断的是弹窗**外面**那行状态而不是确认键：submit 一开始就把弹窗关掉了，
    // 确认键此刻根本不在 DOM 里。触发器搬去导出面板之后，那几秒里唯一的进度
    // 反馈就是这行 —— 它没了，用户会以为点击没生效，转头再点一次。
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('正在投稿'),
    );
    // 弹窗已关 → 用户没法在等待期间再点一次「确认投稿」
    expect(screen.queryByRole('dialog')).toBeNull();
    resolveCreate({ id: 42, uploadToken: 'tok' });
  });
});
