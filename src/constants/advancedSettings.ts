import { COLOR_BUDGET_OPTIONS } from './colorBudget';
import type { ColorBudgetLevel, SampleMode } from '@/types';

/**
 * 参数面板收纳后的「高级设置」折叠头摘要。
 * 收起时也能看到已开了什么；按固定顺序拼接，桌面与移动端共用同一份推导，
 * 避免两处文案漂移。
 */
export interface AdvancedSettingsSummaryInput {
  removeBackground: boolean;
  simplifyColors: boolean;
  watermark: boolean;
  colorBudget: ColorBudgetLevel;
  sampleMode: SampleMode;
}

export function buildAdvancedSettingsSummary(input: AdvancedSettingsSummaryInput): string[] {
  const parts: string[] = [];
  if (input.removeBackground) parts.push('去背景');
  if (input.simplifyColors) parts.push('简化颜色');
  if (input.watermark) parts.push('水印');
  if (input.colorBudget !== 'off') {
    const label = COLOR_BUDGET_OPTIONS.find(o => o.value === input.colorBudget)?.label;
    if (label) parts.push(label);
  }
  if (input.sampleMode === 'similar') parts.push('同步相近色');
  return parts;
}

export function formatAdvancedSettingsSummary(parts: string[]): string {
  return parts.length > 0 ? `已开：${parts.join(' · ')}` : '';
}
