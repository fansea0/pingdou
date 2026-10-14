import type { ColorBudgetLevel } from '@/types';

/**
 * 颜色预算档位。分段控件上只显示「最终色数」这一个数字，
 * 因为用户真正要控制的就是出图用几个颜色；程度形容词放在下方说明里。
 */
export interface ColorBudgetOption {
  readonly value: ColorBudgetLevel;
  readonly label: string;
  readonly hint: string;
}

export const COLOR_BUDGET_OPTIONS: readonly ColorBudgetOption[] = [
  {
    value: 'off',
    label: '不限',
    hint: '保持原图用色数量不变',
  },
  {
    value: 'relaxed',
    label: '12 色',
    hint: '色数最少，备料最省，层次损失明显',
  },
  {
    value: 'standard',
    label: '20 色',
    hint: '色数与画质比较均衡',
  },
  {
    value: 'tight',
    label: '32 色',
    hint: '接近原图观感，只清理零散色',
  },
];

export function findColorBudgetOption(level: ColorBudgetLevel): ColorBudgetOption {
  return COLOR_BUDGET_OPTIONS.find(option => option.value === level) ?? COLOR_BUDGET_OPTIONS[0];
}