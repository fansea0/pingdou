import { BEADS_PER_HOUR } from '@/constants/boardSizes';

export function estimateAssemblyHours(beanCount: number): number | null {
  if (!Number.isFinite(beanCount) || beanCount <= 0) return null;
  return Math.round((beanCount / BEADS_PER_HOUR) * 10) / 10;
}

export function formatAssemblyHours(hours: number | null): string | null {
  return hours === null ? null : `约 ${hours.toFixed(1)} 小时`;
}

/**
 * 预估拼装时间的**分钟数** —— 服务端 works.estimate_minutes 存的就是这个数。
 *
 * 单独导出成函数而不是让调用点自己写 `hours * 60`：这一层换算是「小时/分钟」
 * 混用事故的高发地，写错一次就是 64 倍（6.4 小时被当成 6 分钟存进库里，详情页
 * 直接显示给用户）。它必须有一个不依赖 React 的用例守着。
 *
 * 取整放在换算之后：先按 0.1 小时对齐（约 6 分钟粒度）再换算，与
 * estimateAssemblyHours 那个 0.1 小时的展示口径保持一致。
 */
export function estimateAssemblyMinutes(beanCount: number): number {
  return Math.round((estimateAssemblyHours(beanCount) ?? 0) * 60);
}
