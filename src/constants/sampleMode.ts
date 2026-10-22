import type { SampleMode } from '@/types';

/**
 * 采样模式选项。分段控件上只放模式名，「会变成什么样」的解释放在下方说明里 ——
 * 这两个模式的差别不在于哪种更好，而在于边界格怎么处理。
 */
export interface SampleModeOption {
  readonly value: SampleMode;
  readonly label: string;
  readonly hint: string;
}

export const SAMPLE_MODE_OPTIONS: readonly SampleModeOption[] = [
  {
    value: 'gradient',
    label: '渐变色',
    hint: '格子取平均色，原图的渐变过渡如实保留；边缘可能多出原图没有的混合色',
  },
  {
    value: 'similar',
    label: '同步相近色',
    hint: '边缘格子跟随主色，不再产生原图没有的混合色，色号更省',
  },
];
