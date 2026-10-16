import { useCallback, useEffect, useRef, useState } from 'react';
import { listWorks, type WorkSummary, type WorkSort } from '@/api/works';

const PAGE_SIZE = 20;
/** 搜索防抖：每敲一个字都发请求没必要，等用户停下来再发。 */
const SEARCH_DEBOUNCE_MS = 300;

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
  /** 当前搜索词（原始输入，未防抖）—— 搜索框要即时回显，所以给的是这个。 */
  query: string;
  setQuery: (q: string) => void;
  sort: WorkSort;
  setSort: (s: WorkSort) => void;
}

/**
 * 作品库列表。分页用「加载更多」而不是无限滚动 —— 作品量级还小，
 * 按钮行为可预期、也更好测（spec 7.3）。
 *
 * 排序完全交给服务端：这里的 items 一律按响应里的原样存，不按 likes 之类
 * 的字段重排。排名实时变化会让「点进详情再返回」看到的位次和刚才不一样。
 */
export function useWorks(pageSize: number = PAGE_SIZE): UseWorksResult {
  const [items, setItems] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<WorkSort>('latest');

  // 卸载后不再 setState。首屏请求用 effect 内的 cancelled 标志就够了，
  // loadMore 不在 effect 里，只能靠这个 ref。
  const aliveRef = useRef(true);
  // loadMore 进行中的同步标志。loadingMore 是 state，而 state 更新要到下一次
  // 渲染才对闭包可见：同一 tick 里连点两次，两次 handler 拿到的都是
  // loadingMore === false，会用同一个 offset 重复拉一页。ref 是同步的。
  const pendingRef = useRef(false);
  /**
   * 「当前这一批数据」的序号，每次首屏 effect 重跑就 +1。
   *
   * 边界要说准，别夸大：在 effect 内部，seq 其实是 cancelled 的真子集 ——
   * 序号一变，旧 effect 的 cleanup 必然已经跑过、cancelled 必然已是真。
   * 所以 effect 里不存在「cancelled 挡不住、只有 seq 能挡」的乱序场景，
   * 删掉 effect 里的序号校验并不会削弱那里的防护。
   *
   * 真正不可替代的是 loadMore：它不在 effect 里，没有任何 cleanup 罩着，
   * 翻页途中用户改了搜索词/排序时，旧批次的那一页只有靠这个序号才拦得住。
   */
  const seqRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      pendingRef.current = false;
    };
  }, []);

  // 搜索词防抖：query 变化后等 SEARCH_DEBOUNCE_MS 才真正发请求。
  // 卸载/连续输入时 clearTimeout 是必须的，否则前几次输入排的定时器照样会
  // 到点触发，把早就没意义的中间态也发出去。
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const seq = ++seqRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    listWorks(pageSize, 0, { q: debouncedQuery, sort })
      .then(page => {
        // 双重防护：这个 effect 没被清理、且这是最新一次请求。在 effect 内这两条
        // 其实是重合的（seq 一变，本次 cleanup 必然已跑），这里双写是防御性的 ——
        // 不可替代的仲裁在 loadMore 那条路上，见 seqRef 的注释。
        if (cancelled || seq !== seqRef.current) return;
        // 整页替换而不是追加：换搜索词/排序后上一批结果不再相关，
        // 留着就是「新词的前 10 条 + 上一个词的第 11-20 条」。
        setItems(page.items);
        setTotal(page.total);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled || seq !== seqRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [pageSize, nonce, debouncedQuery, sort]);

  const loadMore = useCallback(() => {
    // loadingMore 必须一起看。以前这个守卫只读 loading（首屏标志）与 pendingRef，
    // loadingMore 从头到尾没被读过，重复请求全靠 WorksListPage 上的
    // disabled={loadingMore} 兜 —— DOM 属性当唯一防线太脆弱：将来谁为了做
    // 「加载更多」的 spinner 样式摘掉 disabled（或换成 aria-disabled / opacity），
    // 重复拉页会静默发生。state 守卫不依赖任何 DOM 属性。
    if (loading || loadingMore || pendingRef.current) return;
    pendingRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const seq = seqRef.current;
    const offset = items.length;
    // 用 debouncedQuery 而不是 query：防抖的 300ms 里 loading 还是 false，
    // loadMore 点得动，而此时屏幕上的卡片属于 debouncedQuery 那一批。
    // 带 query 会拉回来一页跟 offset 不匹配的、屏幕上根本没出现过的数据。
    listWorks(pageSize, offset, { q: debouncedQuery, sort })
      .then(page => {
        pendingRef.current = false;
        // 必须排在下面那两条 early-return 之前：序号不符时直接 return 会跳过
        // 结尾的 setLoadingMore(false)，而 loadingMore 这个 state effect 和 reload
        // 都从不清它 —— 守卫就把「加载更多」永久锁死（hasMore 还是 true，按钮却
        // 永远点不动）。换搜索词也救不回来，因为没有任何路径会复位它。
        setLoadingMore(false);
        if (!aliveRef.current) return;
        // 翻页途中 query/sort 变了，这一页已经不属于当前这批了，丢掉。
        // 不丢的话它会拼到新搜索结果后面 —— 正是「换了词还看到旧词的尾巴」。
        if (seq !== seqRef.current) return;
        // offset 分页 + 后端 ORDER BY created_at DESC, id DESC：两次请求之间若有
        // 新作品插到最前，整页会往后挪一位，offset 就会把上一页的尾项再拉回来 ——
        // 页面上出现重复卡片，React 也会抛重复 key 警告。按 id 去重即可。
        // 作品库是站主手动上传的低频变更，真撞上的概率很低，不值得为此上 cursor。
        setItems(prev => {
          const seen = new Set(prev.map(i => i.id));
          return [...prev, ...page.items.filter(i => !seen.has(i.id))];
        });
        setTotal(page.total);
      })
      .catch((e: unknown) => {
        pendingRef.current = false;
        // 与 then 分支同理：这里 return 得早，loadingMore 的复位必须提前。
        setLoadingMore(false);
        if (!aliveRef.current) return;
        if (seq !== seqRef.current) return;
        // 只写 loadMoreError：写 error 会把整个列表顶掉，用户已经看到的卡片全没了。
        setLoadMoreError(e instanceof Error ? e : new Error(String(e)));
      });
  }, [items.length, loading, loadingMore, pageSize, debouncedQuery, sort]);

  const reload = useCallback(() => {
    // 清干净再 setNonce 重跑首屏 effect（nonce 是触发它重跑的关键，别删）。
    // 以前只 setNonce，旧分页与翻页错误会留在屏幕上和新数据混在一起。
    // 当前 reload 只有首屏 error 分支的重试按钮能触到，那时 items 必为空 ——
    // 这三行是防御性的，防止将来接线变了（例如给非空列表加重试入口）就露馅。
    setItems([]);
    setTotal(0);
    setLoadMoreError(null);
    setError(null);
    setNonce(n => n + 1);
  }, []);

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
    query,
    setQuery,
    sort,
    setSort,
  };
}
