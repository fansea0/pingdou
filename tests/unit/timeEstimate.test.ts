import { describe, expect, it } from 'vitest';
import {
  estimateAssemblyHours,
  estimateAssemblyMinutes,
  formatAssemblyHours,
} from '@/pipeline/timeEstimate';

describe('timeEstimate', () => {
  it('returns null for non-positive and non-finite bean counts', () => {
    expect(estimateAssemblyHours(0)).toBeNull();
    expect(estimateAssemblyHours(-1)).toBeNull();
    expect(estimateAssemblyHours(Number.NaN)).toBeNull();
  });

  it('calculates hours from 600 beads per hour', () => {
    expect(estimateAssemblyHours(600)).toBe(1);
    expect(estimateAssemblyHours(900)).toBe(1.5);
  });

  it('formats a one-decimal Chinese hour label', () => {
    expect(formatAssemblyHours(1.5)).toBe('约 1.5 小时');
    expect(formatAssemblyHours(null)).toBeNull();
  });

  // 下面两条守的是「小时被当成分钟」这一整类事故（差 60 倍）。3814 颗曾被写成
  // 6 分钟 —— Math.round(6.4) 而已，类型系统一个字都不会报。
  it('converts hours to minutes (3814 beads is 384 minutes, not 6)', () => {
    expect(estimateAssemblyMinutes(3814)).toBe(384);
    expect(estimateAssemblyMinutes(600)).toBe(60);
    expect(estimateAssemblyMinutes(900)).toBe(90);
  });

  it('returns 0 minutes for bean counts with no estimate', () => {
    expect(estimateAssemblyMinutes(0)).toBe(0);
    expect(estimateAssemblyMinutes(Number.NaN)).toBe(0);
  });
});
