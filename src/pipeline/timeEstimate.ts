import { BEADS_PER_HOUR } from '@/constants/boardSizes';

export function estimateAssemblyHours(beanCount: number): number | null {
  if (!Number.isFinite(beanCount) || beanCount <= 0) return null;
  return Math.round((beanCount / BEADS_PER_HOUR) * 10) / 10;
}

export function formatAssemblyHours(hours: number | null): string | null {
  return hours === null ? null : `约 ${hours.toFixed(1)} 小时`;
}
