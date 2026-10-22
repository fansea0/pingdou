import { SegmentedPicker } from './SegmentedPicker';
import { COLOR_BUDGET_OPTIONS } from '@/constants/colorBudget';
import type { ColorBudgetLevel } from '@/types';

interface Props {
  value: ColorBudgetLevel;
  onChange: (level: ColorBudgetLevel) => void;
  disabled?: boolean;
}

/**
 * 颜色预算分段控件。桌面参数面板与移动端参数面板共用同一份实现，
 * 避免两处样式和文案漂移。
 */
export function ColorBudgetPicker({ value, onChange, disabled }: Props) {
  return (
    <SegmentedPicker
      label="颜色预算"
      labelHint="· 压缩导出图的用色数量"
      options={COLOR_BUDGET_OPTIONS}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
