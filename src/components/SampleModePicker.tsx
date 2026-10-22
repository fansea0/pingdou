import { SegmentedPicker } from './SegmentedPicker';
import { SAMPLE_MODE_OPTIONS } from '@/constants/sampleMode';
import type { SampleMode } from '@/types';

interface Props {
  value: SampleMode;
  onChange: (mode: SampleMode) => void;
  disabled?: boolean;
}

/**
 * 采样模式分段控件：渐变色（默认，保留原图的渐变过渡）/ 同步相近色
 * （边缘格子跟随主色，不产生原图里没有的混合色）。
 */
export function SampleModePicker({ value, onChange, disabled }: Props) {
  return (
    <SegmentedPicker
      label="采样模式"
      labelHint="· 格子撞上两种颜色时怎么办"
      options={SAMPLE_MODE_OPTIONS}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
