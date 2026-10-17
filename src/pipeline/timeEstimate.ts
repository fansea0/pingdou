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

/**
 * 把 works.estimate_minutes（**分钟数**）渲染成展示文案。
 *
 * 方向与 estimateAssemblyMinutes 相反：那是「豆子数 → 存库」，这是「读库 → 显示」。
 * 两个方向各占一次 60/64 倍换算的一端，所以两端都得是函数、都得有用例。
 * 读这一端现在有两个调用点：后台审核队列（src/pages/admin/WorksTab.tsx）与
 * 作品详情页（src/pages/WorkDetailPage.tsx）—— 两处读的是同一列 works.estimate_minutes。
 * 两处各写一遍 minutes / 60 的话，迟早有一处漏掉那个 60，而类型系统不会报：
 * number 除以 number 永远合法，错的是数字不是类型。所以即使调用点只有两处，
 * 换算也仍然必须收在这一层。
 *
 * 文案复用 formatAssemblyHours 而不是另写一句「约 X 小时」：投稿弹窗、
 * 导出图的图例、后台队列、详情页四处必须读起来是同一句话，改措辞才只需要改一处。
 *
 * 算不出来返回 '—' 而不是「约 0.0 小时」：0 颗豆子不是「不用拼」，
 * 是「估算公式没有输入」。跟投稿弹窗里 formatAssemblyHours 为 null 时的处理一致。
 */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  return formatAssemblyHours(minutes / 60) ?? '—';
}
