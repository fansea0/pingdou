import { describe, expect, it } from 'vitest';
import {
  estimateAssemblyHours,
  estimateAssemblyMinutes,
  formatAssemblyHours,
  formatMinutes,
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

  // 读库方向：后台审核队列与详情页拿到的是 estimate_minutes（分钟），要现算文案。
  // 分母写错一次就是 60 倍，所以这里把 384（6.4 小时）与 190（3.2 小时）两个值
  // 都钉死 —— 190 正是设计文档与若干旧夹具里错写的那个数，它该显示 3.2 而不是 190.0。
  it('formats minutes as hours with the same wording as formatAssemblyHours', () => {
    expect(formatMinutes(384)).toBe('约 6.4 小时');
    expect(formatMinutes(190)).toBe('约 3.2 小时');
    expect(formatMinutes(60)).toBe('约 1.0 小时');
  });

  // 无从估算（0 颗豆子 / 脏数据）不能显示成「约 0.0 小时」——那是个断言，
  // 读起来像「不用拼」而不是「算不出来」。跟投稿弹窗的「—」对齐。
  it('falls back to a dash when minutes cannot be estimated', () => {
    expect(formatMinutes(0)).toBe('—');
    expect(formatMinutes(-1)).toBe('—');
    expect(formatMinutes(Number.NaN)).toBe('—');
  });

  // 存的是分钟、读出来要还原成同一个文案：estimateAssemblyMinutes 先按 0.1 小时
  // 取整再乘 60，formatMinutes 除回 60 必须原样还原，否则后台看到的预估和投稿
  // 弹窗里的对不上，管理员会以为是算错了。
  it('round-trips minutes back to the hour label the submit dialog showed', () => {
    expect(formatMinutes(estimateAssemblyMinutes(3814)))
      .toBe(formatAssemblyHours(estimateAssemblyHours(3814)));
    expect(formatMinutes(estimateAssemblyMinutes(0))).toBe('—');
  });
});
