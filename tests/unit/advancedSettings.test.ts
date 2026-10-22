import { describe, it, expect } from 'vitest';
import {
  buildAdvancedSettingsSummary,
  formatAdvancedSettingsSummary,
} from '@/constants/advancedSettings';
import type { ColorBudgetLevel, SampleMode } from '@/types';

function input(overrides: {
  removeBackground?: boolean;
  simplifyColors?: boolean;
  watermark?: boolean;
  colorBudget?: ColorBudgetLevel;
  sampleMode?: SampleMode;
} = {}) {
  return {
    removeBackground: false,
    simplifyColors: false,
    watermark: false,
    colorBudget: 'off' as ColorBudgetLevel,
    sampleMode: 'gradient' as SampleMode,
    ...overrides,
  };
}

describe('buildAdvancedSettingsSummary', () => {
  it('returns empty when nothing is enabled', () => {
    expect(buildAdvancedSettingsSummary(input())).toEqual([]);
  });

  it('lists each enabled item in fixed order', () => {
    expect(
      buildAdvancedSettingsSummary(
        input({ removeBackground: true, simplifyColors: true, watermark: true, colorBudget: 'standard', sampleMode: 'similar' })
      )
    ).toEqual(['去背景', '简化颜色', '水印', '20 色', '同步相近色']);
  });

  it('maps the color budget to its label only when not off', () => {
    expect(buildAdvancedSettingsSummary(input({ colorBudget: 'minimal' }))).toEqual(['6 色']);
    expect(buildAdvancedSettingsSummary(input({ colorBudget: 'relaxed' }))).toEqual(['12 色']);
    expect(buildAdvancedSettingsSummary(input({ colorBudget: 'standard' }))).toEqual(['20 色']);
  });

  it('does not list the default gradient mode', () => {
    expect(buildAdvancedSettingsSummary(input({ sampleMode: 'gradient' }))).toEqual([]);
  });
});

describe('formatAdvancedSettingsSummary', () => {
  it('prepends 已开 and joins with separator', () => {
    expect(formatAdvancedSettingsSummary(['去背景', '水印'])).toBe('已开：去背景 · 水印');
  });

  it('returns empty string for no parts', () => {
    expect(formatAdvancedSettingsSummary([])).toBe('');
  });
});
