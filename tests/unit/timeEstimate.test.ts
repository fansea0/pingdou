import { describe, expect, it } from 'vitest';
import { estimateAssemblyHours, formatAssemblyHours } from '@/pipeline/timeEstimate';

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
});
