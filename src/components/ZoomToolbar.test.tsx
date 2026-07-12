import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ZoomToolbar } from '@/components/ZoomToolbar';

describe('ZoomToolbar', () => {
  it('renders zoom indicator with current value', () => {
    const { container } = render(
      <ZoomToolbar
        zoom={2}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
        onZoomChange={() => {}}
        disabled={false}
      />
    );
    const input = container.querySelector('input[type=number]') as HTMLInputElement;
    expect(input.value).toBe('2');
  });

  it('clicking + triggers onZoomIn', () => {
    const onZoomIn = vi.fn();
    const { container } = render(
      <ZoomToolbar zoom={1} onZoomIn={onZoomIn} onZoomOut={() => {}} onReset={() => {}} onZoomChange={() => {}} disabled={false} />
    );
    const btn = container.querySelector('[data-testid="zoom-in"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onZoomIn).toHaveBeenCalledOnce();
  });

  it('clicking − triggers onZoomOut', () => {
    const onZoomOut = vi.fn();
    const { container } = render(
      <ZoomToolbar zoom={2} onZoomIn={() => {}} onZoomOut={onZoomOut} onReset={() => {}} onZoomChange={() => {}} disabled={false} />
    );
    const btn = container.querySelector('[data-testid="zoom-out"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onZoomOut).toHaveBeenCalledOnce();
  });

  it('clicking reset triggers onReset', () => {
    const onReset = vi.fn();
    const { container } = render(
      <ZoomToolbar zoom={4} onZoomIn={() => {}} onZoomOut={() => {}} onReset={onReset} onZoomChange={() => {}} disabled={false} />
    );
    const btn = container.querySelector('[data-testid="zoom-reset"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('all buttons disabled when disabled prop is true', () => {
    const { container } = render(
      <ZoomToolbar zoom={1} onZoomIn={() => {}} onZoomOut={() => {}} onReset={() => {}} onZoomChange={() => {}} disabled={true} />
    );
    const buttons = container.querySelectorAll('button');
    buttons.forEach(b => expect(b.disabled).toBe(true));
  });

  it('typing in number input and pressing Enter triggers onZoomChange with parsed value', () => {
    const onZoomChange = vi.fn();
    const { container } = render(
      <ZoomToolbar zoom={1} onZoomIn={() => {}} onZoomOut={() => {}} onReset={() => {}} onZoomChange={onZoomChange} disabled={false} />
    );
    const input = container.querySelector('input[type=number]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onZoomChange).toHaveBeenCalledWith(3);
  });
});