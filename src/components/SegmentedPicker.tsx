import { useId, type CSSProperties } from 'react';
import './SegmentedPicker.css';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** 选中该项时显示在控件下方的说明 */
  readonly hint?: string;
}

interface Props<T extends string> {
  /** 控件上方的小标题，同时作为 radio 组的可访问名称 */
  label: string;
  /** 标题右侧的补充说明 */
  labelHint?: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * 分段选择控件（radio 组）。桌面参数面板与移动端参数面板共用同一份实现，
 * 避免两处样式和文案漂移。
 *
 * 用真实 radio 而非 div 模拟：键盘方向键切换、读屏播报都是原生行为。
 */
export function SegmentedPicker<T extends string>({
  label,
  labelHint,
  options,
  value,
  onChange,
  disabled,
}: Props<T>) {
  // 桌面与移动面板会同时存在于 DOM 中，必须各自独立成组，
  // 否则同名 radio 会被浏览器当成一组而互相取消勾选。
  const groupName = useId();
  const active = options.find(option => option.value === value);

  return (
    <div className="segmented-picker">
      <div className="segmented-picker-label">
        {label}
        {labelHint && <span className="segmented-picker-label-hint">{labelHint}</span>}
      </div>

      <div
        className="segmented-picker-track"
        role="radiogroup"
        aria-label={label}
        style={{ '--seg-columns': options.length } as CSSProperties}
      >
        {options.map(option => (
          <label
            key={option.value}
            className={`segmented-picker-option${
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

      {active?.hint && <p className="segmented-picker-hint">{active.hint}</p>}
    </div>
  );
}
