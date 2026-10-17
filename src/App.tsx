import { useEffect, useMemo, useState } from 'react';
import { usePalette } from '@/hooks/usePalette';
import { usePipeline } from '@/hooks/usePipeline';
import { useSampleImage } from '@/hooks/useSampleImage';
import { useSiteConfig } from '@/hooks/useSiteConfig';
import { UploadZone } from '@/components/UploadZone';
import { ParamPanel } from '@/components/ParamPanel';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import { ColorLegend } from '@/components/ColorLegend';
import { ExportPanel } from '@/components/ExportPanel';
import { SubmitWorkButton } from '@/components/SubmitWorkButton';
import { MobileActionBar } from '@/components/MobileActionBar';
import { SiteStats } from '@/components/SiteStats';
import { ProductShowcase } from '@/components/ProductShowcase';
import { Disclaimer } from '@/components/Disclaimer';
import { SiteNav } from '@/components/SiteNav';
import { computeLegend } from '@/pipeline/legend';
import {
  estimateAssemblyHours,
  estimateAssemblyMinutes,
  formatAssemblyHours,
} from '@/pipeline/timeEstimate';
import { usePageView, trackImageExport } from '@/hooks/useTracking';
import type { ColorBudgetLevel, ColorSimplificationStats, ProcessParams } from '@/types';

const PREVIEW_CELL_PX = 24;
const EMPTY_COLOR_SIMPLIFICATION: ColorSimplificationStats = Object.freeze({
  beforeColorCount: 0,
  afterColorCount: 0,
  mergedColorCount: 0,
  rareColorCountBefore: 0,
  rareColorCountAfter: 0,
  minimumColorCountSatisfied: false,
  budgetLevel: 'off',
  budgetTargetColorCount: 0,
  budgetSatisfied: true,
  budgetFidelityLimited: false,
});

export function App() {
  const { palette, error: paletteError } = usePalette();
  const { status, result, error, process, reprocess, exportMulti } = usePipeline(palette);
  const { imageData: sample } = useSampleImage();
  const { config: siteConfig, loaded: siteConfigLoaded } = useSiteConfig();
  const [gridSize, setGridSize] = useState(100);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [simplifyColors, setSimplifyColors] = useState(true);
  const [tightCrop, setTightCrop] = useState(true);
  const [colorBudget, setColorBudget] = useState<ColorBudgetLevel>('standard');
  const [exporting, setExporting] = useState(false);
  const [exportFlash, setExportFlash] = useState<'idle' | 'done'>('idle');

  usePageView();

  const legend = useMemo(
    () => (result && palette ? computeLegend(result.indices, palette, result.mask) : []),
    [result, palette]
  );
  const statisticsCurrent =
    result !== null && result.simplifyColors === simplifyColors && result.colorBudget === colorBudget;

  // 所有处理入口共用同一份参数，避免各处漏改某个开关
  const currentParams = (patch: Partial<ProcessParams> = {}): ProcessParams => ({
    gridSize,
    removeBackground,
    simplifyColors,
    tightCrop,
    colorBudget,
    ...patch,
  });

  const beanCount = useMemo(() => {
    if (!result) return 0;
    let drawn = 0;
    for (let i = 0; i < result.mask.length; i++) {
      if (!result.mask[i]) drawn++;
    }
    return drawn;
  }, [result]);

  const totalCells = result ? result.outW * result.outH : 0;
  const estimateLabel = useMemo(
    () => formatAssemblyHours(estimateAssemblyHours(beanCount)),
    [beanCount]
  );
  // 投稿要入库的是「分钟数」，换算规则在 timeEstimate.ts 里（hours × 60），
  // App 这边只负责接线 —— 换算本身有独立用例守着，不该在这里重写一遍。
  const estimateMinutes = useMemo(() => estimateAssemblyMinutes(beanCount), [beanCount]);

  // Auto-process sample image once palette and sample are both ready
  useEffect(() => {
    if (sample && palette && status === 'idle') {
      process(sample, currentParams());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, palette, status]);

  if (paletteError) {
    return (
      <div className="app">
        <p className="error">色板加载失败：{paletteError.message}。请刷新重试。</p>
      </div>
    );
  }

  if (!palette) {
    return (
      <div className="app">
        <header>
          <h1>拼豆图生成器</h1>
          <p className="subtitle">色板加载中...</p>
          <SiteStats />
        </header>
      </div>
    );
  }

  const handleExport = async () => {
    if (!result || exporting) return;
    setExporting(true);
    setExportFlash('idle');
    try {
      const out = await exportMulti(32, gridSize, []);
      if (out && out.success > 0) {
        trackImageExport();
        setExportFlash('done');
        window.setTimeout(() => setExportFlash('idle'), 2400);
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>🐰 拼豆图生成器</h1>
        <p className="subtitle">
          上传图片 → 一键生成你的拼豆图纸
          <span className="subtitle-palette">（MARD {palette.length} 色）</span>
        </p>
        <SiteStats />
        {/* 读真实 pathname 而不是写死 "/": App 只在 home 或未知路径渲染；
            未知路径下两个导航项都不高亮，所以读 pathname 与写死 "/" 等价。
            保留读取是为了将来若引入 client-side 路由，导航栏不会错位。 */}
        <SiteNav current={typeof window !== 'undefined' ? window.location.pathname : '/'} />
      </header>

      {error && <p className="error">处理异常：{error.message}</p>}

      <main className="layout-3col">
        <aside className="left">
          <UploadZone onLoad={(data) => process(data, currentParams())} />
          <ParamPanel
            gridSize={gridSize}
            beanCount={beanCount}
            totalCells={totalCells}
            actualSize={
              result ? { width: result.outW, height: result.outH, cropped: result.cropped } : null
            }
            estimateLabel={estimateLabel}
            removeBackground={removeBackground}
            simplifyColors={simplifyColors}
            tightCrop={tightCrop}
            colorBudget={colorBudget}
            onGridSizeChange={n => {
              setGridSize(n);
              reprocess(currentParams({ gridSize: n }));
            }}
            onRemoveBackgroundChange={b => {
              setRemoveBackground(b);
              reprocess(currentParams({ removeBackground: b }));
            }}
            onSimplifyColorsChange={enabled => {
              setSimplifyColors(enabled);
              reprocess(currentParams({ simplifyColors: enabled }));
            }}
            onTightCropChange={enabled => {
              setTightCrop(enabled);
              reprocess(currentParams({ tightCrop: enabled }));
            }}
            onColorBudgetChange={level => {
              setColorBudget(level);
              reprocess(currentParams({ colorBudget: level }));
            }}
            disabled={status === 'idle' || status === 'loading'}
          />
          {/* 投稿按钮放在参数面板之下、导出之上：两者都是「拿这张图纸去做点什么」，
              而参数是它们共同的前置输入。移动端 layout-3col 变单列堆叠后，
              它自然落在参数面板下方、预览区上方，不进 MobileActionBar ——
              那里已经有上传和导出，再塞第三个操作会让底部条拥挤。 */}
          <SubmitWorkButton
            palette={palette}
            result={result}
            beanCount={beanCount}
            colorCount={legend.length}
            estimateLabel={estimateLabel}
            estimateMinutes={estimateMinutes}
            disabled={status === 'idle' || status === 'loading'}
          />
          <ExportPanel
            disabled={!result || exporting}
            onExport={handleExport}
            exporting={exporting}
            flash={exportFlash}
          />
        </aside>

        <section className="middle">
          <PreviewCanvas
            result={result}
            palette={palette}
            cellPx={PREVIEW_CELL_PX}
            isRecomputing={status === 'recomputing'}
            statusSlot={
              /* Desktop already shows this inside ParamPanel; the strip only
                 renders on mobile, where the toolbar used to carry it. */
              <p className="preview-status">
                {beanCount > 0 ? (
                  <>
                    <strong>{beanCount.toLocaleString()}</strong> 颗
                    {estimateLabel && <span> · {estimateLabel}</span>}
                    {removeBackground && (
                      <span className="preview-status-flag"> · 已去背景</span>
                    )}
                  </>
                ) : (
                  <span>未上传图片</span>
                )}
              </p>
            }
          />
        </section>

        <aside className="right">
          <ColorLegend
            legend={legend}
            colorSimplification={result?.colorSimplification ?? EMPTY_COLOR_SIMPLIFICATION}
            simplifyColors={simplifyColors}
            statisticsCurrent={statisticsCurrent}
          />
        </aside>
      </main>

      {siteConfigLoaded && siteConfig.showProducts && <ProductShowcase />}

      <Disclaimer />

      <MobileActionBar
        gridSize={gridSize}
        removeBackground={removeBackground}
        simplifyColors={simplifyColors}
        tightCrop={tightCrop}
        colorBudget={colorBudget}
        onGridSizeChange={n => {
          setGridSize(n);
          reprocess(currentParams({ gridSize: n }));
        }}
        onRemoveBackgroundChange={b => {
          setRemoveBackground(b);
          reprocess(currentParams({ removeBackground: b }));
        }}
        onSimplifyColorsChange={enabled => {
          setSimplifyColors(enabled);
          reprocess(currentParams({ simplifyColors: enabled }));
        }}
        onTightCropChange={enabled => {
          setTightCrop(enabled);
          reprocess(currentParams({ tightCrop: enabled }));
        }}
        onColorBudgetChange={level => {
          setColorBudget(level);
          reprocess(currentParams({ colorBudget: level }));
        }}
        onLoad={(data) => process(data, currentParams())}
        onExport={handleExport}
        canExport={!!result}
        exporting={exporting}
        flash={exportFlash}
      />

      <footer className="app-footer">
        <p>© 拼豆图生成器 · 仅作手工参考 · 颜色归各品牌所有</p>
        {/* 《非经营性互联网信息服务备案管理办法》第十三条：主页底部中央标明
            备案编号，并链接工信部备案管理系统。 */}
        <p className="app-footer-filing">
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
            鄂ICP备2026055552号-1
          </a>
        </p>
      </footer>

      {exportFlash === 'done' && (
        <div className="export-toast" role="status" aria-live="polite">
          <span className="export-toast-text">下载成功！到下载文件夹找它吧～</span>
        </div>
      )}
    </div>
  );
}
