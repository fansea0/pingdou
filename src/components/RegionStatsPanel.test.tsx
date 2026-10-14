import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetchRegions: vi.fn(),
  setSelfFingerprint: vi.fn(),
}));

vi.mock('@/api/statics', () => ({
  fetchRegions: mocks.fetchRegions,
  setSelfFingerprint: mocks.setSelfFingerprint,
}));

import { RegionStatsPanel } from './RegionStatsPanel';

const REGIONS = {
  days: 30,
  totals: {
    pv: 12, uv: 5, selfPv: 7, selfUv: 1,
    externalPv: 5, externalUv: 4, unknownPv: 1, unknownUv: 1,
  },
  provinces: [
    { province: '广东省', pv: 4, uv: 3, selfPv: 1, externalPv: 3, externalUv: 2, share: 0.75 },
    { province: '浙江省', pv: 1, uv: 1, selfPv: 0, externalPv: 1, externalUv: 1, share: 0.25 },
  ],
  cities: [
    { province: '广东省', city: '深圳市', pv: 3, uv: 2, selfPv: 1, externalPv: 2, externalUv: 2 },
    { province: '广东省', city: '广州市', pv: 1, uv: 1, selfPv: 0, externalPv: 1, externalUv: 1 },
  ],
  perDay: [
    { day: '2026-10-13', pv: 6, selfPv: 5, externalPv: 1, externalUv: 1 },
    { day: '2026-10-14', pv: 6, selfPv: 2, externalPv: 4, externalUv: 3 },
  ],
  coverage: { resolvedPv: 11, resolvedUv: 4, totalPv: 12, totalUv: 5 },
  geo: { available: true, cached: 3 },
  selfFingerprintEnabled: false,
};

describe('RegionStatsPanel', () => {
  beforeEach(() => {
    mocks.fetchRegions.mockReset();
    mocks.setSelfFingerprint.mockReset();
    mocks.fetchRegions.mockResolvedValue(REGIONS);
  });

  afterEach(() => cleanup());

  it('概览把外部 / 内部并列，默认排除自我访问', async () => {
    render(<RegionStatsPanel />);
    expect(await screen.findByText('外部访客 UV')).toBeTruthy();
    expect(screen.getByText('内部访问 UV')).toBeTruthy();
    // 默认只按外部指标着色 / 排行
    expect((screen.getByTestId('exclude-self-toggle') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('当前只看外部访客')).toBeTruthy();
  });

  it('关掉「排除我的访问」后按总量排行', async () => {
    render(<RegionStatsPanel />);
    await screen.findByText('外部访客 UV');
    fireEvent.click(screen.getByTestId('exclude-self-toggle'));
    expect(screen.getByText('当前含内部访问')).toBeTruthy();
    // 广东 pv=4 > 浙江 pv=1，排序不变但数值变为总量
    const guangdongRow = screen.getByText('广东省').closest('li')!;
    expect(guangdongRow.textContent).toContain('4');
  });

  it('点击省份下钻到城市，再点「回到全国」还原', async () => {
    render(<RegionStatsPanel />);
    await screen.findByText('外部访客 UV');
    fireEvent.click(screen.getByText('广东省'));
    expect(await screen.findByText('广东 · 城市')).toBeTruthy();
    expect(screen.getByText('深圳市')).toBeTruthy();
    expect(screen.getByText('广州市')).toBeTruthy();
    expect(screen.queryByText('浙江省')).toBeNull();

    fireEvent.click(screen.getByText('回到全国'));
    expect(await screen.findByText('省份排行')).toBeTruthy();
    expect(screen.getByText('浙江省')).toBeTruthy();
  });

  it('覆盖率与未归属量如实展示', async () => {
    render(<RegionStatsPanel />);
    expect(await screen.findByText(/已识别 92% 的 PV/)).toBeTruthy();
    expect(screen.getByText(/1 次未归属/)).toBeTruthy();
  });

  it('标记我的访问开关调用后端并回显状态', async () => {
    mocks.setSelfFingerprint.mockResolvedValueOnce({ ok: true, enabled: true });
    render(<RegionStatsPanel />);
    await screen.findByText('外部访客 UV');
    fireEvent.click(screen.getByTestId('mark-self-toggle'));
    await waitFor(() => expect(mocks.setSelfFingerprint).toHaveBeenCalledWith(true));
    expect(await screen.findByText('已按当前 IP 识别')).toBeTruthy();
  });

  it('开关失败时把错误显示出来，不静默吞掉', async () => {
    mocks.setSelfFingerprint.mockRejectedValueOnce(new Error('boom'));
    render(<RegionStatsPanel />);
    await screen.findByText('外部访客 UV');
    fireEvent.click(screen.getByTestId('mark-self-toggle'));
    expect(await screen.findByText('boom')).toBeTruthy();
  });

  it('完全没数据时给明确空态，不显示空白面板', async () => {
    mocks.fetchRegions.mockResolvedValueOnce({
      ...REGIONS,
      totals: { pv: 0, uv: 0, selfPv: 0, selfUv: 0, externalPv: 0, externalUv: 0, unknownPv: 0, unknownUv: 0 },
      provinces: [], cities: [],
      coverage: { resolvedPv: 0, resolvedUv: 0, totalPv: 0, totalUv: 0 },
    });
    render(<RegionStatsPanel />);
    expect(await screen.findByText('最近 30 天还没有访问记录。')).toBeTruthy();
  });

  it('切时间窗会重新拉取并收回下钻', async () => {
    render(<RegionStatsPanel />);
    await screen.findByText('外部访客 UV');
    fireEvent.click(screen.getByText('广东省'));
    await screen.findByText('广东 · 城市');

    fireEvent.change(screen.getByLabelText('来源地统计时间范围'), { target: { value: '7' } });
    await waitFor(() => expect(mocks.fetchRegions).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.getByText('省份排行')).toBeTruthy());
  });

  it('趋势图的日期标签不在 SVG 里（preserveAspectRatio=none 会把 SVG 文字压扁）', async () => {
    const { container } = render(<RegionStatsPanel />);
    await screen.findByText('外部访客 UV');

    const bars = container.querySelector('.region-trend__bars')!;
    expect(bars.tagName.toLowerCase()).toBe('svg');
    // 柱子可以横向拉伸，文字不行——文字必须搬到 HTML 轴上
    expect(bars.getAttribute('preserveAspectRatio')).toBe('none');
    expect(bars.querySelector('text')).toBeNull();

    const axis = container.querySelector('.region-trend__axis')!;
    // 每个数据点一个等宽格子，跳过的留空占位，标签才能和柱子对齐
    expect(axis.children).toHaveLength(REGIONS.perDay.length);
    const labels = Array.from(axis.children).map(el => el.textContent);
    expect(labels.some(t => t && t.length > 0)).toBe(true);
    expect(labels.filter(Boolean).every(t => /^\d{2}-\d{2}$/.test(t!))).toBe(true);
  });

  it('接口报错时给出可读错误', async () => {
    mocks.fetchRegions.mockRejectedValueOnce(new Error('网络炸了'));
    render(<RegionStatsPanel />);
    expect(await screen.findByText(/来源地加载失败：网络炸了/)).toBeTruthy();
  });
});
