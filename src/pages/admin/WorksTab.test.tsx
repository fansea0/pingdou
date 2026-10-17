import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
// 注意导入源是 @testing-library/react 而不是 @testing-library/dom：
// render 是 react 包的导出，dom 包不提供，照 dom 包导入拿到的是 undefined。
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { WorksTab } from './WorksTab';

const adminListWorks = vi.fn();
const adminApproveWork = vi.fn();
const adminRejectWork = vi.fn();
const adminUpdateWork = vi.fn();
const adminDeleteWork = vi.fn();

// 用仓库既有的 vi.mock + importActual 范式（与本文件改动前的写法一致），
// 不要改成 vi.spyOn 打在模块命名空间上。
vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return {
    ...actual,
    adminListWorks: (...a: unknown[]) => adminListWorks(...a),
    adminApproveWork: (...a: unknown[]) => adminApproveWork(...a),
    adminRejectWork: (...a: unknown[]) => adminRejectWork(...a),
    adminUpdateWork: (...a: unknown[]) => adminUpdateWork(...a),
    adminDeleteWork: (...a: unknown[]) => adminDeleteWork(...a),
  };
});

const BASE = {
  id: 1, title: '待审作品', description: '', published: false,
  thumbUrl: '/media/works/a-t.webp', imageUrl: '/media/works/a.png',
  width: 100, height: 100, bytes: 1024, createdAt: 1, updatedAt: 1, likes: 0,
  boardW: 87, boardH: 62, beanCount: 3814, colorCount: 42,
  // 必须与 estimateAssemblyMinutes(3814) 一致（384），不能写成 190。
  // estimateAssemblyMinutes 先按 0.1 小时取整再乘 60，3814 颗的真实工时是
  // 384 分钟；夹具里放一个对不上的数，后来者照着它反推公式就会把「小时当分钟」
  // 这个刚修好的 64 倍 bug 原样带回来。
  estimateMinutes: 384,
};
const PENDING = { ...BASE, status: 'pending' as const };
const APPROVED = { ...BASE, id: 2, title: '已上架', status: 'approved' as const, published: true };
const UNLISTED = { ...APPROVED, id: 3, title: '已下架', published: false };
const REJECTED = { ...BASE, id: 4, title: '被拒的', status: 'rejected' as const };

let confirmSpy: MockInstance<typeof window.confirm>;

/**
 * window.confirm 在拒绝/删除路径上会被问，返回 true 让流程走到底。
 * 返回值存进 confirmSpy：只 stub 不断言的话，「实现根本没调 confirm」也会绿，
 * 而静默删除比误删更糟 —— 那条护栏必须钉住「问过」，不只是「删掉了」。
 */
function acceptConfirm(): void {
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
}

/**
 * 等列表加载完的**唯一**可靠信号是审核按钮，不是作品标题。
 *
 * 标题渲染在受控 <input> 的 value 上，而 RTL 的文本匹配只看元素的子文本节点，
 * 不读 input 的 value —— 所以 getByText('待审作品') 永远命中不了（同理，
 * region.textContent 里也永远没有标题，行有没有移动不能靠它判断）。
 * 按钮的角色 + 无障碍名（按钮文案里就带着标题）既能等就绪，也能断行去了哪。
 */
function findApproveButton(title: string): Promise<HTMLElement> {
  return screen.findByRole('button', { name: `通过 ${title}` });
}

beforeEach(() => {
  adminListWorks.mockReset().mockResolvedValue([PENDING, APPROVED, UNLISTED, REJECTED]);
  adminApproveWork.mockReset().mockResolvedValue({ ...PENDING, status: 'approved', published: true });
  adminRejectWork.mockReset().mockResolvedValue({ ...PENDING, status: 'rejected' });
  adminUpdateWork.mockReset().mockImplementation(async (id: number, patch: { published?: boolean; title?: string }) => ({
    ...APPROVED, id, ...patch,
  }));
  adminDeleteWork.mockReset().mockResolvedValue({ ok: true });
  acceptConfirm();
});

// vitest.config.ts 是 globals:false，RTL 的自动 cleanup 不注册。少了这行 DOM 会
// 跨用例残留，实现完全正确也会红（本文件改前就有这条注释）。
afterEach(cleanup);

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('WorksTab 审核队列', () => {
  it('后台上传入口已彻底消失', async () => {
    render(<WorksTab />);
    await findApproveButton('待审作品');
    expect(screen.queryByText('上传作品')).toBeNull();
    expect(screen.queryByLabelText(/选择图片/)).toBeNull();
  });

  it('待审核区显示四个图纸参数', async () => {
    render(<WorksTab />);
    await findApproveButton('待审作品');
    const pendingSection = screen.getByRole('region', { name: '待审核' });
    expect(pendingSection.textContent).toContain('87 × 62');
    expect(pendingSection.textContent).toContain('3,814');
    expect(pendingSection.textContent).toContain('42 种颜色');
    expect(pendingSection.textContent).toContain('约 6.4 小时');
    // 分钟数不能原样当小时显示：384 是「约 6.4 小时」，不是「约 384.0 小时」。
    expect(pendingSection.textContent).not.toContain('384');
  });

  it('待审核区提供通过与拒绝两个动作', async () => {
    render(<WorksTab />);
    await findApproveButton('待审作品');
    expect(screen.getByRole('button', { name: '通过 待审作品' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝 待审作品' })).toBeTruthy();
  });

  it('点通过后行进入作品集并已上架', async () => {
    render(<WorksTab />);
    fireEvent.click(await findApproveButton('待审作品'));
    await waitFor(() => expect(adminApproveWork).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: '待审核' })).queryByRole('button', { name: '通过 待审作品' })
      ).toBeNull()
    );
    // 进了作品集还不够：通过动作本身要连带上架，按钮文案才是「下架」而不是「上架」
    const gallery = within(screen.getByRole('region', { name: '作品集' }));
    expect(gallery.getByRole('button', { name: '下架 待审作品' })).toBeTruthy();
  });

  it('点拒绝前必须二次确认，确认后行离开待审核区', async () => {
    render(<WorksTab />);
    await findApproveButton('待审作品');
    fireEvent.click(screen.getByRole('button', { name: '拒绝 待审作品' }));
    // 护栏：只断言 adminRejectWork 被调到过是不够的 —— 实现漏掉 confirm 也会绿，
    // 而拒绝会连带永久删掉源文件，用户连后悔的机会都没有。
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    await waitFor(() => expect(adminRejectWork).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: '待审核' })).queryByRole('button', { name: '拒绝 待审作品' })
      ).toBeNull()
    );
    const rejected = within(screen.getByRole('region', { name: '已拒绝' }));
    expect(rejected.getByRole('button', { name: '彻底删除 待审作品' })).toBeTruthy();
  });

  it('通过是收窄集合的动作，不弹确认框', async () => {
    render(<WorksTab />);
    fireEvent.click(await findApproveButton('待审作品'));
    await waitFor(() => expect(adminApproveWork).toHaveBeenCalledWith(1));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('已拒绝的行不渲染 img（文件已删，画出来是破图），改显示文字占位', async () => {
    render(<WorksTab />);
    await screen.findByRole('button', { name: '彻底删除 被拒的' });
    const rejectedSection = screen.getByRole('region', { name: '已拒绝' });
    expect(rejectedSection.textContent).toContain('源文件已删除');
    expect(rejectedSection.querySelector('img')).toBeNull();
  });

  it('已上架的作品显示「下架」按钮，已下架的显示「上架」', async () => {
    render(<WorksTab />);
    // 就绪信号用按钮而不是 getByText('已下架')：夹具里作品标题就叫「已下架」，
    // 未上架行的状态标记也显示「已下架」，getByText 命中两个元素会直接抛错。
    await screen.findByRole('button', { name: '上架 已下架' });
    expect(screen.getByRole('button', { name: '下架 已上架' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '上架 已下架' })).toBeTruthy();
  });

  it('点上架调用 adminUpdateWork 并把 published 置 true', async () => {
    render(<WorksTab />);
    fireEvent.click(await screen.findByRole('button', { name: '上架 已下架' }));
    await waitFor(() => expect(adminUpdateWork).toHaveBeenCalledWith(3, { published: true }));
  });

  // 乐观更新 + 失败回滚。通过动作先把这行挪进作品集，服务端失败后必须挪回来，
  // 否则行就「卡」在错误的那一区，站主刷新页面之前再也点不到它。
  it('操作失败时回滚并显示中文错误', async () => {
    adminApproveWork.mockRejectedValue(new Error('磁盘满了'));
    render(<WorksTab />);
    fireEvent.click(await findApproveButton('待审作品'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('磁盘满了'));
    // 回滚：行仍在待审核区，且作品集里不能留下这次失败的痕迹
    const pending = within(screen.getByRole('region', { name: '待审核' }));
    expect(pending.getByRole('button', { name: '通过 待审作品' })).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: '作品集' })).queryByRole('button', { name: '下架 待审作品' })
    ).toBeNull();
  });

  it('没有图片的 pending 行显示「图片未上传」并仍可被拒绝', async () => {
    adminListWorks.mockResolvedValue([{ ...PENDING, id: 5, title: '半途而废', imageUrl: '' }]);
    render(<WorksTab />);
    await findApproveButton('半途而废');
    const pendingSection = screen.getByRole('region', { name: '待审核' });
    expect(pendingSection.textContent).toContain('图片未上传');
    fireEvent.click(screen.getByRole('button', { name: '拒绝 半途而废' }));
    await waitFor(() => expect(adminRejectWork).toHaveBeenCalledWith(5));
  });

  it('空列表给出投稿引导，三个分区仍然渲染', async () => {
    adminListWorks.mockResolvedValue([]);
    render(<WorksTab />);
    // 「还没有上传作品」这个旧文案已经作废：进货渠道现在是投稿，站主看到
    // 「还没有作品」不会去找一个已经删掉的上传按钮。
    expect(await screen.findByText(/还没有作品/)).toBeTruthy();
    expect(screen.getByRole('region', { name: '待审核' })).toBeTruthy();
  });

  // 删除会连带删掉磁盘上的图片，静默删除比误删更糟：确认框必须真的弹出来，
  // 且用户点「取消」时一次请求都不能发。
  it('删除前必须二次确认，取消则一个请求都不发', async () => {
    render(<WorksTab />);
    const del = await screen.findByRole('button', { name: '删除 已下架' });

    confirmSpy.mockReturnValue(false);
    fireEvent.click(del);
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(adminDeleteWork).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '删除 已下架' })).toBeTruthy();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '删除 已下架' }));
    await waitFor(() => expect(adminDeleteWork).toHaveBeenCalledWith(3));
    // 调了接口还不够：行必须真的从列表里消失。少了这半句，把 setWorks 的
    // filter 整段删掉测试照样全绿 —— 界面上会留着一行点不动也删不掉的幽灵作品，
    // 而站主没有任何办法刷新掉它（删除按钮已经随幽灵行一起失效了）。
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: '作品集' })).queryByRole('button', { name: '删除 已下架' })
      ).toBeNull()
    );
  });

  // ↓↓ 以下三条与「上传通道」无关，是整体替换测试文件时被顺带弄掉的旧护栏。
  // 它们守的机制（草稿回落 / 红条清除）在审核队列版里原样存在，补回来，
  // 否则「整体替换」就把三道护栏换成了一句「本轮没有覆盖到这里」。

  // 护栏：受控草稿态必须在保存成功后让界面回落成**服务端规范化过的值**。
  // 变异目标：删掉 onBlur 里的 dropDraft，或把 value 改成不带 ?? work.title 回落。
  it('标题保存后按服务端规范化值刷新输入框', async () => {
    adminListWorks.mockResolvedValue([{ ...APPROVED, title: '旧标题' }]);
    adminUpdateWork.mockResolvedValue({ ...APPROVED, id: 2, title: '未命名作品' });
    render(<WorksTab />);
    await screen.findByRole('button', { name: '下架 旧标题' });
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
    adminListWorks.mockResolvedValue([{ ...APPROVED, title: '旧标题' }]);
    let resolveUpdate: (v: unknown) => void = () => {};
    adminUpdateWork.mockReset().mockReturnValue(new Promise((r) => { resolveUpdate = r; }));
    render(<WorksTab />);
    await screen.findByRole('button', { name: '下架 旧标题' });
    const input = screen.getByLabelText('旧标题 标题') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.blur(input);
    await waitFor(() => expect(adminUpdateWork).toHaveBeenCalledWith(2, { title: '新标题' }));

    // 响应还没回来，用户已经点回同一个输入框继续打字
    fireEvent.change(input, { target: { value: '新标题继续写' } });
    resolveUpdate({ ...APPROVED, id: 2, title: '新标题' });
    await waitFor(() =>
      expect((screen.getByLabelText('新标题 标题') as HTMLInputElement).value).toBe('新标题继续写')
    );
  });

  // 护栏：红条永不清除会让「下一次成功操作」看着像也失败了。
  it('成功操作后清掉旧的错误提示', async () => {
    render(<WorksTab />);
    await screen.findByRole('button', { name: '下架 已上架' });

    // 1. 上下架失败 → 红条；再成功 → 红条必须消失。第二次点的是同一个按钮：
    //    失败后 published 已回滚，按钮文案也回落到「下架」。
    adminUpdateWork.mockRejectedValueOnce(new Error('boom-toggle'));
    fireEvent.click(screen.getByRole('button', { name: '下架 已上架' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    adminUpdateWork.mockResolvedValueOnce({ ...APPROVED, id: 2, published: false });
    fireEvent.click(screen.getByRole('button', { name: '下架 已上架' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    // 2. 改标题失败 → 红条；再改成功 → 红条必须消失。两次都查「已上架 标题」：
    //    失败那次标题没变，无障碍名不会跟着动。
    adminUpdateWork.mockRejectedValueOnce(new Error('boom-title'));
    fireEvent.change(screen.getByLabelText('已上架 标题'), { target: { value: 'B' } });
    fireEvent.blur(screen.getByLabelText('已上架 标题'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    adminUpdateWork.mockResolvedValueOnce({ ...APPROVED, id: 2, title: 'B' });
    fireEvent.change(screen.getByLabelText('已上架 标题'), { target: { value: 'C' } });
    fireEvent.blur(screen.getByLabelText('已上架 标题'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    // 3. 删除失败 → 红条；再删成功 → 红条必须消失（标题上一步已改成 B；
    //    用完整按钮名而不是 /^删除 /，默认夹具里作品集有两行，会命中两个按钮）
    adminDeleteWork.mockRejectedValueOnce(new Error('boom-delete'));
    fireEvent.click(screen.getByRole('button', { name: '删除 B' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    adminDeleteWork.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: '删除 B' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    // 4. 审核失败 → 红条；再通过成功 → 红条必须消失。审核路径的 setError(null)
    //    与上面三条是各自独立的调用点，漏掉一条的后果是：审核重试成功了，
    //    上一次「磁盘满了」的红条还挂在界面上，站主会以为重试也失败了。
    //    失败后行已回滚到待审核区，所以两次点的是同一个按钮。
    adminApproveWork.mockRejectedValueOnce(new Error('boom-approve'));
    fireEvent.click(screen.getByRole('button', { name: '通过 待审作品' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    adminApproveWork.mockResolvedValueOnce({ ...PENDING, status: 'approved', published: true });
    fireEvent.click(screen.getByRole('button', { name: '通过 待审作品' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
