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
});
