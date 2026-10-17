import { useEffect, useRef, useState } from 'react';
import { fetchLikeState, likeWork, type WorkSummary } from '@/api/works';

/**
 * 单个作品的点赞按钮。列表页与详情页共用。
 *
 * 文案是「N 次点赞」而不是「N 人喜欢」：限流粒度是「每 IP 每图每天一次」、
 * 且不支持取消，同一个人第二天可以再点一次，计数会累加 —— 写「人」是误导。
 */
export function LikeButton({
  work,
  onError,
}: {
  work: WorkSummary;
  onError: (message: string) => void;
}) {
  const [likes, setLikes] = useState(work.likes);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * 同步的「正在请求」标志。
   *
   * busy 是 state，而 state 更新要到下一次渲染才对闭包可见：同一个事件里连点三次，
   * 三个 handler 读到的都是同一个 busy === false，会发出三次请求。DOM 上的
   * disabled 同理挡不住这一批（disabled 要等渲染提交才生效），所以用 ref ——
   * 写 ref 是同步的。这与 useWorks 里 loadMore 的 pendingRef 是同一个道理。
   */
  const busyRef = useRef(false);

  // 挂载时问一次「我今天赞过没」。不能靠本次会话的内存：用户刷新页面回来
  // 应该还记得自己赞过，否则会重复提交一次（服务端幂等，但数字会闪一下）。
  // 注意只读 likes/liked 两个字段，绝不碰父级的 items —— 列表顺序以服务端为准。
  useEffect(() => {
    let cancelled = false;
    fetchLikeState(work.id)
      .then(s => {
        if (cancelled) return;
        setLikes(s.likes);
        setLiked(s.liked);
      })
      .catch(() => {
        // 读不到就按未赞处理，不打扰用户 —— 真正点下去时服务端会兜底
      });
    return () => { cancelled = true; };
  }, [work.id]);

  const onClick = async () => {
    if (busyRef.current || liked) return;
    busyRef.current = true;
    setBusy(true);
    // 乐观更新前的快照。用局部变量而不是 state：setRollback 要等下一次渲染才
    // 可见，catch 里的闭包拿到的仍是旧值（永远 null），回滚就会退化成
    // 「回滚到组件首次挂载时的 work.likes」，翻页后数字会跳。
    const prevLikes = likes;
    setLikes(n => n + 1);          // 乐观更新，点击手感即时
    setLiked(true);
    try {
      const r = await likeWork(work.id);
      // 用服务端的权威值覆盖：今天已经赞过时它不会变，乐观多加的那 1 要收回
      setLikes(r.likes);
      setLiked(true);
    } catch (e) {
      setLikes(prevLikes);
      setLiked(false);
      onError(likeErrorText(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={liked ? 'works-like works-like--on' : 'works-like'}
      onClick={onClick}
      disabled={liked || busy}
      aria-pressed={liked}
      aria-label={liked ? `已赞，${likes} 次点赞` : `${likes} 次点赞`}
    >
      <span aria-hidden="true">{liked ? '♥' : '♡'}</span>
      {likes}
    </button>
  );
}

/**
 * 服务端错误文案到用户可读文案的翻译。
 *
 * 目前只翻 429：令牌桶超限时后端回的是英文 'too many likes, try again later'，
 * 直接甩给中文用户看不懂。其他错误原样透传 —— 网络错误的原文（如 'Failed to
 * fetch'）本来就比我们自己编一句更准确。
 */
function likeErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/too many likes|429/i.test(raw)) return '点得太快啦，稍等 1 秒再试';
  return raw;
}
