import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { WorksTab } from './WorksTab';

const adminListWorks = vi.fn();
const adminCreateWork = vi.fn();
const adminUpdateWork = vi.fn();
const adminDeleteWork = vi.fn();

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return {
    ...actual,
    adminListWorks: () => adminListWorks(),
    adminCreateWork: (...a: unknown[]) => adminCreateWork(...a),
    adminUpdateWork: (...a: unknown[]) => adminUpdateWork(...a),
    adminDeleteWork: (...a: unknown[]) => adminDeleteWork(...a),
  };
});

/** jsdom 没有 canvas.toBlob；缩略图生成失败在真机上也会降级，这里直接覆盖该路径 */
beforeEach(() => {
  adminListWorks.mockReset().mockResolvedValue([]);
  adminCreateWork.mockReset().mockResolvedValue({
    id: 1, title: '新作品', description: '', thumbUrl: '/media/works/x.png',
    imageUrl: '/media/works/x.png', width: 0, height: 0, bytes: 1, createdAt: 1, published: true,
  });
  adminUpdateWork.mockReset();
  adminDeleteWork.mockReset().mockResolvedValue({ ok: true });
});

/**
 * vitest.config.ts 是 globals: false，RTL 的自动 cleanup 不注册，
 * 不手动清就会跨用例泄漏 DOM，第二个用例 getByText 会撞到上一个的残留节点。
 */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeFile(name = 'a.png', type = 'image/png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type });
}

/**
 * 给 makeThumb 造一套只够跑通的可桩环境（jsdom 里 createImageBitmap / canvas 都没有）：
 * toBlob 返回指定 mime 的 blob，用来模拟浏览器「不支持 webp 编码时按规范回落成 PNG」。
 * 返回还原函数。
 */
function stubThumbEncoding(blobType: string): () => void {
  const g = globalThis as { createImageBitmap?: unknown };
  const hadBitmap = 'createImageBitmap' in g;
  const prevBitmap = g.createImageBitmap;
  g.createImageBitmap = vi.fn().mockResolvedValue({ width: 800, height: 600, close: () => {} });
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage: () => {} } as never);
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation(function (cb: BlobCallback) {
      cb(new Blob([new Uint8Array([1, 2, 3])], { type: blobType }));
    });
  return () => {
    getContext.mockRestore();
    toBlob.mockRestore();
    if (hadBitmap) g.createImageBitmap = prevBitmap;
    else delete g.createImageBitmap;
  };
}

describe('WorksTab', () => {
  it('渲染已上架和草稿作品', async () => {
    adminListWorks.mockResolvedValue([
      { id: 1, title: '已上架', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
        width: 0, height: 0, bytes: 1, published: true, createdAt: 1 },
      { id: 2, title: '草稿作品', description: '', thumbUrl: '/b.png', imageUrl: '/b.png',
        width: 0, height: 0, bytes: 1, published: false, createdAt: 2 },
    ] as never);
    render(<WorksTab />);
    // 用精确串而非正则：作品标题同时出现在上下架 label 和「删除 X」按钮里，
    // 正则会两边都命中，getByText 直接报 multiple elements
    expect(await screen.findByText('已上架')).toBeTruthy();
    expect(screen.getByText('草稿作品')).toBeTruthy();
  });

  it('草稿的上下架 checkbox 默认不勾选', async () => {
    adminListWorks.mockResolvedValue([
      { id: 2, title: '草稿作品', description: '', thumbUrl: '/b.png', imageUrl: '/b.png',
        width: 0, height: 0, bytes: 1, published: false, createdAt: 2 },
    ] as never);
    render(<WorksTab />);
    await screen.findByText('草稿作品');
    expect((screen.getByRole('checkbox', { name: '草稿作品' }) as HTMLInputElement).checked).toBe(false);
  });

  it('空列表给出提示', async () => {
    render(<WorksTab />);
    expect(await screen.findByText(/还没有上传作品/)).toBeTruthy();
  });

  it('选图 + 填标题后上传走 adminCreateWork', async () => {
    render(<WorksTab />);
    await screen.findByText(/还没有上传作品/);

    const input = screen.getByLabelText(/选择图片/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '我的新作品' } });

    fireEvent.click(screen.getByRole('button', { name: '上传' }));

    await waitFor(() => expect(adminCreateWork).toHaveBeenCalled());
    const [file, opts] = adminCreateWork.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(opts.title).toBe('我的新作品');
    expect(opts.published).toBe(true);
  });

  it('取消「立即上架」时传 published=false', async () => {
    render(<WorksTab />);
    await screen.findByText(/还没有上传作品/);

    const input = screen.getByLabelText(/选择图片/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByLabelText(/立即上架/));
    fireEvent.click(screen.getByRole('button', { name: '上传' }));

    await waitFor(() => expect(adminCreateWork).toHaveBeenCalled());
    expect(adminCreateWork.mock.calls[0][1].published).toBe(false);
  });

  it('切换上架状态调 adminUpdateWork', async () => {
    adminListWorks.mockResolvedValue([
      { id: 5, title: 'A', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
        width: 0, height: 0, bytes: 1, createdAt: 1, published: true },
    ] as never);
    adminUpdateWork.mockResolvedValue({
      id: 5, title: 'A', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
      width: 0, height: 0, bytes: 1, createdAt: 1, published: false,
    } as never);
    render(<WorksTab />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    await waitFor(() => expect(adminUpdateWork).toHaveBeenCalledWith(5, { published: false }));
    // 切换成功后 checkbox 要跟着服务端返回的 published 落下，而不是永远勾着
    await waitFor(() =>
      expect((screen.getByRole('checkbox', { name: 'A' }) as HTMLInputElement).checked).toBe(false)
    );
  });

  it('删除前确认，确认后调 adminDeleteWork', async () => {
    adminListWorks.mockResolvedValue([
      { id: 7, title: 'B', description: '', thumbUrl: '/b.png', imageUrl: '/b.png',
        width: 0, height: 0, bytes: 1, createdAt: 1, published: true },
    ] as never);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<WorksTab />);
    await screen.findByText('B');
    fireEvent.click(screen.getByRole('button', { name: '删除 B' }));
    await waitFor(() => expect(adminDeleteWork).toHaveBeenCalledWith(7));
    confirmSpy.mockRestore();
  });

  it('取消确认则不删除', async () => {
    adminListWorks.mockResolvedValue([
      { id: 7, title: 'B', description: '', thumbUrl: '/b.png', imageUrl: '/b.png',
        width: 0, height: 0, bytes: 1, createdAt: 1, published: true },
    ] as never);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<WorksTab />);
    await screen.findByText('B');
    fireEvent.click(screen.getByRole('button', { name: '删除 B' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(adminDeleteWork).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // 护栏：受控草稿态必须在保存成功后让界面回落成**服务端规范化过的值**。
  // 上一轮这里是 key 强制重挂载（key={work.title}），能刷出新值但会吞掉用户输入；
  // 改法换成 drafts 回落后，靠的是「草稿清空 → value 回落成 work.title」。
  // 变异目标：删掉 onBlur 里的 dropDraft，或把 value 改成不带 ?? work.title 回落。
  it('标题保存后按服务端规范化值刷新输入框', async () => {
    adminListWorks.mockResolvedValue([
      { id: 9, title: '旧标题', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
        width: 0, height: 0, bytes: 1, createdAt: 1, published: true },
    ] as never);
    adminUpdateWork.mockResolvedValue({
      id: 9, title: '未命名作品', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
      width: 0, height: 0, bytes: 1, createdAt: 1, published: true,
    } as never);
    render(<WorksTab />);
    await screen.findByText('旧标题');
    const input = screen.getByLabelText('旧标题 标题') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    // 服务端把空白标题规范化成「未命名作品」，界面必须跟着变
    await waitFor(() =>
      expect((screen.getByLabelText('未命名作品 标题') as HTMLInputElement).value).toBe('未命名作品')
    );
  });

  // key 强制重挂载引入的回归：保存响应到达时若重挂载输入框，用户正在输入的
  // 未保存内容会被静默丢弃。这里钉住「打字过程中不丢字」。
  it('保存响应到达时不吞掉用户正在输入的内容', async () => {
    adminListWorks.mockResolvedValue([
      { id: 9, title: '旧标题', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
        width: 0, height: 0, bytes: 1, createdAt: 1, published: true },
    ] as never);
    let resolveUpdate: (v: unknown) => void = () => {};
    adminUpdateWork.mockReset().mockReturnValue(new Promise(r => { resolveUpdate = r; }));
    render(<WorksTab />);
    await screen.findByText('旧标题');
    const input = screen.getByLabelText('旧标题 标题') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.blur(input);
    await waitFor(() => expect(adminUpdateWork).toHaveBeenCalledWith(9, { title: '新标题' }));

    // 响应还没回来，用户已经点回同一个输入框继续打字
    fireEvent.change(input, { target: { value: '新标题继续写' } });
    resolveUpdate({
      id: 9, title: '新标题', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
      width: 0, height: 0, bytes: 1, createdAt: 1, published: true,
    });
    await waitFor(() =>
      expect((screen.getByLabelText('新标题 标题') as HTMLInputElement).value).toBe('新标题继续写')
    );
  });

  // 护栏：canvas.toBlob 在不支持 WebP 编码的浏览器上按规范回落成 image/png，
  // 把这个 PNG 当缩略图传上去，服务端 extFor 拿到 .png 会 400 掉整次上传。
  it('浏览器回落成 PNG 时按「无缩略图」上传，不把 PNG 冒充 webp', async () => {
    const restore = stubThumbEncoding('image/png');
    try {
      render(<WorksTab />);
      await screen.findByText(/还没有上传作品/);
      const input = screen.getByLabelText(/选择图片/) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [makeFile()] } });
      fireEvent.click(screen.getByRole('button', { name: '上传' }));

      await waitFor(() => expect(adminCreateWork).toHaveBeenCalled());
      const [file, opts] = adminCreateWork.mock.calls[0];
      expect(file).toBeInstanceOf(File);
      expect(opts.thumb).toBeNull();
      // 尺寸是缩略图生成路径顺带带出来的：拿不到缩略图就没有尺寸可传
      expect(opts.width).toBeUndefined();
    } finally {
      restore();
    }
  });

  // 护栏：红条永不清除会让「下一次成功操作」看着像也失败了。
  it('成功操作后清掉旧的错误提示', async () => {
    adminListWorks.mockResolvedValue([
      { id: 5, title: 'A', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
        width: 0, height: 0, bytes: 1, createdAt: 1, published: true },
    ] as never);
    const okWork = { id: 5, title: 'A', description: '', thumbUrl: '/a.png', imageUrl: '/a.png',
      width: 0, height: 0, bytes: 1, createdAt: 1, published: false };
    render(<WorksTab />);
    await screen.findByText('A');

    // 1. 切换上下架失败 → 红条；再切成功 → 红条必须消失
    adminUpdateWork.mockRejectedValueOnce(new Error('boom-toggle'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    adminUpdateWork.mockResolvedValueOnce(okWork as never);
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    // 2. 改标题失败 → 红条；再改成功 → 红条必须消失
    adminUpdateWork.mockRejectedValueOnce(new Error('boom-title'));
    fireEvent.change(screen.getByLabelText('A 标题'), { target: { value: 'B' } });
    fireEvent.blur(screen.getByLabelText('A 标题'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    adminUpdateWork.mockResolvedValueOnce({ ...okWork, title: 'B' } as never);
    fireEvent.change(screen.getByLabelText('A 标题'), { target: { value: 'C' } });
    fireEvent.blur(screen.getByLabelText('A 标题'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    // 3. 删除失败 → 红条；再删成功 → 红条必须消失（标题上一步已改成 B，用通配选按钮）
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    adminDeleteWork.mockRejectedValueOnce(new Error('boom-delete'));
    fireEvent.click(screen.getByRole('button', { name: /^删除 / }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    adminDeleteWork.mockResolvedValueOnce({ ok: true } as never);
    fireEvent.click(screen.getByRole('button', { name: /^删除 / }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    confirmSpy.mockRestore();
  });
});
