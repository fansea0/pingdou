import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LikeButton } from './LikeButton';

const likeWork = vi.fn();
const fetchLikeState = vi.fn();

vi.mock('@/api/works', async () => {
  const actual = await vi.importActual<typeof import('@/api/works')>('@/api/works');
  return {
    ...actual,
    likeWork: (...a: unknown[]) => likeWork(...a),
    fetchLikeState: (...a: unknown[]) => fetchLikeState(...a),
  };
});

beforeEach(() => {
  likeWork.mockReset().mockResolvedValue({ ok: true, likes: 6, alreadyLiked: true });
  fetchLikeState.mockReset().mockResolvedValue({ likes: 5, liked: false });
});

// vitest runs with globals:false，RTL 的自动 cleanup 没注册，否则 DOM 会跨用例残留。
afterEach(cleanup);
afterEach(() => { vi.clearAllMocks(); });

function work(likes: number) {
  return {
    id: 1,
    title: 'A',
    thumbUrl: '/media/works/0000000000000001.png',
    width: 800,
    height: 1000,
    createdAt: 1_700_000_000_000,
    likes,
  };
}

const noop = () => {};

describe('busyRef 复位（回归护栏）', () => {
  it('失败回滚后还能再点：同步「正在请求」标志必须复位', async () => {
    // 首票失败、次票成功 —— 真实场景里用户会直接再点一次。
    likeWork.mockRejectedValueOnce(new Error('网络炸了'));
    render(<LikeButton work={work(5)} onError={noop} />);
    const btn = await screen.findByRole('button', { name: /5 次点赞/ });

    fireEvent.click(btn);
    // 失败回滚后按钮重新可点（state 层的 busy 已复位）
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /5 次点赞/ }) as HTMLButtonElement).disabled).toBe(false),
    );

    // 判别力来源：组件的 finally 里少了 busyRef.current = false 时，DOM 的 disabled
    // 确实回到了 false（setBusy(false) 还在），但 onClick 第一行 `if (busyRef.current)`
    // 会把这一次点击直接吞掉 —— 按钮「看着可点、点不动」，永久失效。
    fireEvent.click(screen.getByRole('button', { name: /5 次点赞/ }));
    await waitFor(() => expect(likeWork).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: /6 次点赞/ })).toBeTruthy();
  });
});

describe('乐观更新失败时回滚到本次点击前的值（回归护栏）', () => {
  it('回滚用的是点击那一刻的数字，而不是组件首次挂载时的 work.likes', async () => {
    // 挂载时 work.likes = 5，随后 fetchLikeState 把 state 刷成 7（别的访客刚赞过）。
    fetchLikeState.mockResolvedValue({ likes: 7, liked: false });
    likeWork.mockRejectedValue(new Error('网络炸了'));
    render(<LikeButton work={work(5)} onError={noop} />);
    await screen.findByRole('button', { name: /7 次点赞/ });

    fireEvent.click(screen.getByRole('button', { name: /7 次点赞/ }));

    // 判别力来源：快照存成 state 时，catch 闭包永远读到 null，
    // 回滚会退化成「回到 work.likes」，这里显示 5 而不是 7 —— 用户看到数字跳回陈旧值。
    expect(await screen.findByRole('button', { name: /7 次点赞/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /5 次点赞/ })).toBeNull();
  });
});
