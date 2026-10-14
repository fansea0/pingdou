import { useId } from 'react';
import './ColorBudgetPicker.css';
import { COLOR_BUDGET_OPTIONS, findColorBudgetOption } from '@/constants/colorBudget';
import type { ColorBudgetLevel } from '@/types';

interface Props {
  value: ColorBudgetLevel;
  onChange: (level: ColorBudgetLevel) => void;
  disabled?: boolean;
}

/**
 * 颜色预算分段控件。桌面参数面板与移动端参数面板共用同一份实现，
 * 避免两处样式和文案漂移。
 *
 * 用真实 radio 而非 div 模拟：键盘方向键切换、读屏播报都是原生行为。
 */
export function ColorBudgetPicker({ value, onChange, disabled }: Props) {
  const active = findColorBudgetOption(value);
  // 桌面与移动面板会同时存在于 DOM 中，必须各自独立成组，
  // 否则同名 radio 会被浏览器当成一组而互相取消勾选。
  const groupName = useId();

  return (
    <div className="budget-picker">
      <div className="budget-picker-label">
        颜色预算
        <span className="budget-picker-label-hint">· 压缩导出图的用色数量</span>
      </div>

      <div className="budget-picker-track" role="radiogroup" aria-label="颜色预算">
        {COLOR_BUDGET_OPTIONS.map(option => (
          <label
            key={option.value}
            className={`budget-picker-option${
              option.value === value ? ' is-active' : ''
            }`}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={option.value === value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>

      <p className="budget-picker-hint">{active.hint}</p>
    </div>
  );
}