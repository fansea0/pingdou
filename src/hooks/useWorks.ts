import { useCallback, useEffect, useRef, useState } from 'react';
import { listWorks, type WorkSummary } from '@/api/works';

const PAGE_SIZE = 20;

export interface UseWorksResult {
  items: WorkSummary[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  /** 首屏加载失败。整个列表被它顶掉（此时一条数据也没有）。 */
  error: Error | null;
  /** 「加载更多」失败。只提示，已加载的列表保留 —— 与 error 分开是刻意的。 */
  loadMoreError: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * 作品库列表。分页用「加载更多」而不是无限滚动 —— 作品量级还小，
 * 按钮行为可预期、也更好测（spec 7.3）。
 */
export function useWorks(pageSize: number = PAGE_SIZE): UseWorksResult {
  const [items, setItems] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  // 卸载后不再 setState。首屏请求用 effect 内的 cancelled 标志就够了，
  // loadMore 不在 effect 里，只能靠这个 ref。
  const aliveRef = useRef(true);
  // loadMore 进行中的同步标志。loadingMore 是 state，而 state 更新要到下一次
  // 渲染才对闭包可见：同一 tick 里连点两次，两次 handler 拿到的都是
  // loadingMore === false，会用同一个 offset 重复拉一页。ref 是同步的。
  const pendingRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      pendingRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listWorks(pageSize, 0)
      .then(page => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [pageSize, nonce]);

  const loadMore = useCallback(() => {
    if (loading || pendingRef.current) return;
    pendingRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const offset = items.length;
    listWorks(pageSize, offset)
      .then(page => {
        pendingRef.current = false;
        if (!aliveRef.current) return;
        setItems(prev => [...prev, ...page.items]);
        setTotal(page.total);
        setLoadingMore(false);
      })
      .catch((e: unknown) => {
        pendingRef.current = false;
        if (!aliveRef.current) return;
        // 只写 loadMoreError：写 error 会把整个列表顶掉，用户已经看到的卡片全没了。
        setLoadMoreError(e instanceof Error ? e : new Error(String(e)));
        setLoadingMore(false);
      });
  }, [items.length, loading, pageSize]);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  return {
    items,
    total,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore: items.length < total,
    loadMore,
    reload,
  };
}
