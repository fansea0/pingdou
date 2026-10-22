import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { ParamPanel } from '@/components/ParamPanel';

const baseProps = () => ({
  gridSize: 100,
  beanCount: 10000,
  totalCells: 10000,
  removeBackground: false,
  simplifyColors: false,
  tightCrop: true,
  onGridSizeChange: () => {},
  onRemoveBackgroundChange: () => {},
  onSimplifyColorsChange: () => {},
  onTightCropChange: () => {},
  colorBudget: 'off' as const,
  onColorBudgetChange: () => {},
  sampleMode: 'gradient' as const,
  onSampleModeChange: () => {},
  watermark: true,
  onWatermarkChange: () => {},
});

describe('ParamPanel', () => {
  it('renders 8 scatter preset buttons for grid sizes', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    const presets = container.querySelectorAll('.grid-preset');
    expect(presets).toHaveLength(8);
  });

  it('displays bean count formatted with locale string', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    expect(container.textContent).toMatch(/10,000/);
  });

  it('displays "—" when bean count is 0', () => {
    const { container } = render(<ParamPanel {...baseProps()} beanCount={0} />);
    const el = container.querySelector('.bean-count');
    expect(el?.textContent).toMatch(/—/);
  });

  it('clicking a scatter button triggers onGridSizeChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ParamPanel {...baseProps()} onGridSizeChange={onChange} />
    );
    const presets = container.querySelectorAll('.grid-preset');
    fireEvent.click(presets[3]);
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it('marks main presets (20-100) with .main class', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    const mainPresets = container.querySelectorAll('.grid-preset.main');
    expect(mainPresets).toHaveLength(5);
  });

  it('marks current gridSize preset with .active class', () => {
    const { container } = render(
      <ParamPanel {...baseProps()} gridSize={50} beanCount={2500} />
    );
    const activeDots = container.querySelectorAll('.grid-preset.active');
    expect(activeDots).toHaveLength(1);
    const valueBadge = container.querySelector('.grid-progress-value');
    expect(valueBadge?.textContent).toBe('50');
  });

  it('exposes distinct background removal, tight crop, color simplification and watermark options (no dither)', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(4);
    expect(within(container).getByRole('checkbox', { name: /自动去背景/ })).toBeTruthy();
    expect(within(container).getByRole('checkbox', { name: /紧裁边缘/ })).toBeTruthy();
    expect(within(container).getByRole('checkbox', { name: /自动简化颜色/ })).toBeTruthy();
    expect(within(container).getByRole('checkbox', { name: /添加水印/ })).toBeTruthy();
  });

  it('places the watermark toggle right after the color simplification one', () => {
    // 顺序是产品要求（水印排在「自动简化颜色」后面）：只断存在性的话，
    // 有人把它挪到面板顶部也不会红
    const { container } = render(<ParamPanel {...baseProps()} />);
    const labels = Array.from(container.querySelectorAll('label.param-toggle')).map(l =>
      l.textContent ?? ''
    );
    const simplifyAt = labels.findIndex(t => t.includes('自动简化颜色'));
    expect(simplifyAt).toBeGreaterThanOrEqual(0);
    expect(labels[simplifyAt + 1]).toMatch(/添加水印/);
  });

  it('keeps the watermark on by default and renders its hint', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    const checkbox = within(container).getByRole('checkbox', { name: /添加水印/ });

    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(checkbox.closest('label')?.querySelector('.param-toggle-hint')?.textContent).toBe(
      ' · 导出图页眉右侧的拼豆.xyz 标识',
    );
  });

  it('toggling the watermark fires onWatermarkChange', () => {
    const onChange = vi.fn();
    const { container } = render(<ParamPanel {...baseProps()} onWatermarkChange={onChange} />);

    fireEvent.click(within(container).getByRole('checkbox', { name: /添加水印/ }));

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('defaults tight crop to on and disables it without background removal', () => {
    const on = render(<ParamPanel {...baseProps()} removeBackground />);
    const tightCrop = within(on.container).getByRole('checkbox', { name: /紧裁边缘/ }) as HTMLInputElement;
    expect(tightCrop.checked).toBe(true);
    expect(tightCrop.disabled).toBe(false);
    on.unmount();

    const off = render(<ParamPanel {...baseProps()} removeBackground={false} />);
    const disabled = within(off.container).getByRole('checkbox', { name: /紧裁边缘/ }) as HTMLInputElement;
    expect(disabled.disabled).toBe(true);
  });

  it('reports the cropped chart size once cropping kicked in', () => {
    const { container } = render(
      <ParamPanel {...baseProps()} actualSize={{ width: 57, height: 63, cropped: true }} />
    );
    expect(container.textContent).toMatch(/图纸 57 × 63 格/);
  });

  it('hides the cropped size hint when nothing was cropped', () => {
    const { container } = render(
      <ParamPanel {...baseProps()} actualSize={{ width: 100, height: 100, cropped: false }} />
    );
    expect(container.textContent).not.toMatch(/图纸 100 × 100 格/);
  });

  it('renders automatic color simplification off by default with its hint', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);
    const checkbox = within(container).getByRole('checkbox', { name: /自动简化颜色/ });

    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(checkbox.closest('label')?.querySelector('.param-toggle-hint')?.textContent).toBe(
      ' · 启用后每种颜色至少 10 颗',
    );
  });

  it('toggling automatic color simplification fires onSimplifyColorsChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ParamPanel {...baseProps()} onSimplifyColorsChange={onChange} />
    );

    fireEvent.click(within(container).getByRole('checkbox', { name: /自动简化颜色/ }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggling removeBackground fires onRemoveBackgroundChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ParamPanel {...baseProps()} onRemoveBackgroundChange={onChange} />
    );
    const checkbox = container.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('shows removed count annotation when bg removal is on', () => {
    const { container } = render(
      <ParamPanel
        {...baseProps()}
        removeBackground={true}
        beanCount={7000}
        totalCells={10000}
      />
    );
    expect(container.textContent).toMatch(/已去\s*3,000\s*颗背景/);
  });

  it('hides removed count annotation when bg removal is off', () => {
    const { container } = render(
      <ParamPanel
        {...baseProps()}
        removeBackground={false}
        beanCount={7000}
        totalCells={10000}
      />
    );
    expect(container.textContent).not.toMatch(/已去/);
  });

  it('offers board-size shortcuts that select the matching grid size', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ParamPanel {...baseProps()} onGridSizeChange={onChange} estimateLabel="约 4.0 小时" />
    );
    const shortcuts = within(container.querySelector('[aria-label="快捷板子尺寸"]')!);

    fireEvent.click(shortcuts.getByRole('button', { name: '78 × 78 板子' }));

    expect(onChange).toHaveBeenCalledWith(78);
  });

  it('collapses everything but size and grid into an advanced settings fold, closed by default', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);

    const details = container.querySelector('details.advanced-settings') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const summary = container.querySelector('details.advanced-settings summary')!;
    expect(summary.textContent).toContain('高级设置');
    // 摘要只显示已开启的项；baseProps 里只有水印开
    expect(summary.textContent).toContain('已开：水印');
    // 核心区不受影响
    expect(within(container).getByRole('slider')).toBeTruthy();
  });

  it('opens the advanced fold on summary click and exposes every control', () => {
    const { container } = render(<ParamPanel {...baseProps()} />);

    fireEvent.click(container.querySelector('details.advanced-settings summary')!);
    expect(
      (container.querySelector('details.advanced-settings') as HTMLDetailsElement).open
    ).toBe(true);

    // 六个控件：采样模式两个 radio、四个开关、颜色预算四个 radio
    expect(within(container).getByRole('radio', { name: '渐变色' })).toBeTruthy();
    expect(within(container).getByRole('radio', { name: '同步相近色' })).toBeTruthy();
    expect(within(container).getByRole('checkbox', { name: /自动去背景/ })).toBeTruthy();
    expect(within(container).getByRole('checkbox', { name: /紧裁边缘/ })).toBeTruthy();
    expect(within(container).getByRole('checkbox', { name: /自动简化颜色/ })).toBeTruthy();
    expect(within(container).getByRole('checkbox', { name: /添加水印/ })).toBeTruthy();
    expect(within(container).getByRole('radio', { name: '不限' })).toBeTruthy();
    expect(within(container).getByRole('radio', { name: '20 色' })).toBeTruthy();
  });

  it('summarises every enabled advanced option in fixed order', () => {
    const { container } = render(
      <ParamPanel
        {...baseProps()}
        removeBackground
        simplifyColors
        colorBudget="standard"
        sampleMode="similar"
        watermark
      />
    );
    const summary = container.querySelector('details.advanced-settings summary')!;
    expect(summary.textContent).toContain('已开：去背景 · 简化颜色 · 水印 · 20 色 · 同步相近色');
  });

  it('defaults the sample mode to the gradient one and reports a switch', () => {
    const onChange = vi.fn();
    const { container } = render(<ParamPanel {...baseProps()} onSampleModeChange={onChange} />);

    const gradient = within(container).getByRole('radio', { name: '渐变色' }) as HTMLInputElement;
    const similar = within(container).getByRole('radio', { name: '同步相近色' }) as HTMLInputElement;
    expect(gradient.checked).toBe(true);
    expect(similar.checked).toBe(false);

    fireEvent.click(similar);

    expect(onChange).toHaveBeenCalledWith('similar');
  });

  it('highlights the selected board size and renders its estimate', () => {
    const { container } = render(
      <ParamPanel {...baseProps()} gridSize={52} estimateLabel="约 4.0 小时" />
    );
    const shortcuts = within(container.querySelector('[aria-label="快捷板子尺寸"]')!);

    expect(shortcuts.getByRole('button', { name: '52 × 52 板子' }).classList.contains('active')).toBe(true);
    expect(within(container).getByText(/约 4\.0 小时/)).toBeTruthy();
  });
});
