import { useEffect, useMemo, useState } from 'react';
import { usePalette } from '@/hooks/usePalette';
import { usePipeline } from '@/hooks/usePipeline';
import { useSampleImage } from '@/hooks/useSampleImage';
import { UploadZone } from '@/components/UploadZone';
import { ParamPanel } from '@/components/ParamPanel';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import { ColorLegend } from '@/components/ColorLegend';
import { ExportPanel } from '@/components/ExportPanel';
import { MobileActionBar } from '@/components/MobileActionBar';
import { SiteStats } from '@/components/SiteStats';
import { ProductShowcase } from '@/components/ProductShowcase';
import { Disclaimer } from '@/components/Disclaimer';
import { computeLegend } from '@/pipeline/legend';
import { estimateAssemblyHours, formatAssemblyHours } from '@/pipeline/timeEstimate';
import { usePageView, trackImageExport } from '@/hooks/useTracking';
import type { ColorSimplificationStats } from '@/types';

const PREVIEW_CELL_PX = 24;
const EMPTY_COLOR_SIMPLIFICATION: ColorSimplificationStats = Object.freeze({
  beforeColorCount: 0,
  afterColorCount: 0,
  mergedColorCount: 0,
  rareColorCountBefore: 0,
  rareColorCountAfter: 0,
  minimumColorCountSatisfied: false,
});

export function App() {
  const { palette, error: paletteError } = usePalette();
  const { status, result, error, process, reprocess, exportMulti } = usePipeline(palette);
  const { imageData: sample } = useSampleImage();
  const [gridSize, setGridSize] = useState(100);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [simplifyColors, setSimplifyColors] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportFlash, setExportFlash] = useState<'idle' | 'done'>('idle');

  usePageView();

  const legend = useMemo(
    () => (result && palette ? computeLegend(result.indices, palette, result.mask) : []),
    [result, palette]
  );
  const statisticsCurrent = result !== null && result.simplifyColors === simplifyColors;

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

  // Auto-process sample image once palette and sample are both ready
  useEffect(() => {
    if (sample && palette && status === 'idle') {
      process(sample, { gridSize, removeBackground, simplifyColors });
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
        <p className="subtitle">上传图片 → 一键生成你的拼豆图纸（MARD {palette.length} 色）</p>
        <SiteStats />
      </header>

      {error && <p className="error">处理异常：{error.message}</p>}

      <main className="layout-3col">
        <aside className="left">
          <UploadZone onLoad={(data) => process(data, { gridSize, removeBackground, simplifyColors })} />
          <ParamPanel
            gridSize={gridSize}
            beanCount={beanCount}
            totalCells={totalCells}
            estimateLabel={estimateLabel}
            removeBackground={removeBackground}
            simplifyColors={simplifyColors}
            onGridSizeChange={n => {
              setGridSize(n);
              reprocess({ gridSize: n, removeBackground, simplifyColors });
            }}
            onRemoveBackgroundChange={b => {
              setRemoveBackground(b);
              reprocess({ gridSize, removeBackground: b, simplifyColors });
            }}
            onSimplifyColorsChange={enabled => {
              setSimplifyColors(enabled);
              reprocess({ gridSize, removeBackground, simplifyColors: enabled });
            }}
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

      <ProductShowcase />

      <Disclaimer />

      <MobileActionBar
        gridSize={gridSize}
        beanCount={beanCount}
        estimateLabel={estimateLabel}
        removeBackground={removeBackground}
        simplifyColors={simplifyColors}
        onGridSizeChange={n => {
          setGridSize(n);
          reprocess({ gridSize: n, removeBackground, simplifyColors });
        }}
        onRemoveBackgroundChange={b => {
          setRemoveBackground(b);
          reprocess({ gridSize, removeBackground: b, simplifyColors });
        }}
        onSimplifyColorsChange={enabled => {
          setSimplifyColors(enabled);
          reprocess({ gridSize, removeBackground, simplifyColors: enabled });
        }}
        onLoad={(data) => process(data, { gridSize, removeBackground, simplifyColors })}
        onExport={handleExport}
        canExport={!!result}
        exporting={exporting}
        flash={exportFlash}
      />

      <footer className="app-footer">
        <p>© 拼豆图生成器 · 仅作手工参考 · 颜色归各品牌所有</p>
      </footer>

      {exportFlash === 'done' && (
        <div className="export-toast" role="status" aria-live="polite">
          <span className="export-toast-text">导出成功！到下载文件夹找它吧～</span>
        </div>
      )}
    </div>
  );
}
