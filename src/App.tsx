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
import { ProductShowcase } from '@/components/ProductShowcase';
import { computeLegend } from '@/pipeline/legend';

const PREVIEW_CELL_PX = 24;

export function App() {
  const { palette, error: paletteError } = usePalette();
  const { status, result, error, process, reprocess, exportMulti } = usePipeline(palette);
  const { imageData: sample } = useSampleImage();
  const [gridSize, setGridSize] = useState(100);
  const [enableDither, setEnableDither] = useState(false);
  const [exporting, setExporting] = useState(false);

  const legend = useMemo(
    () => (result && palette ? computeLegend(result.indices, palette) : []),
    [result, palette]
  );

  const beanCount = result ? result.outW * result.outH : 0;

  // Auto-process sample image once palette and sample are both ready
  useEffect(() => {
    if (sample && palette && status === 'idle') {
      process(sample, { gridSize, enableDither });
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
        </header>
      </div>
    );
  }

  const handleExport = async () => {
    if (!result || exporting) return;
    setExporting(true);
    try {
      await exportMulti(32, []);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>🐰 拼豆图生成器</h1>
        <p className="subtitle">上传图片 → 一键生成你的拼豆图纸（MARD {palette.length} 色）</p>
      </header>

      {error && <p className="error">处理异常：{error.message}</p>}

      <main className="layout-3col">
        <aside className="left">
          <UploadZone onLoad={(data) => process(data, { gridSize, enableDither })} />
          <ParamPanel
            gridSize={gridSize}
            beanCount={beanCount}
            onGridSizeChange={n => {
              setGridSize(n);
              reprocess({ gridSize: n, enableDither });
            }}
            enableDither={enableDither}
            onDitherChange={b => {
              setEnableDither(b);
              reprocess({ gridSize, enableDither: b });
            }}
            disabled={status === 'idle' || status === 'loading'}
          />
          <ExportPanel
            disabled={!result || exporting}
            onExport={handleExport}
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
          <ColorLegend legend={legend} />
        </aside>
      </main>

      <ProductShowcase />

      <MobileActionBar
        gridSize={gridSize}
        beanCount={beanCount}
        onGridSizeChange={n => {
          setGridSize(n);
          reprocess({ gridSize: n, enableDither });
        }}
        onLoad={(data) => process(data, { gridSize, enableDither })}
        onExport={handleExport}
        canExport={!!result}
        exporting={exporting}
      />

      <footer className="app-footer">
        <p>© 拼豆图生成器 · 仅作手工参考 · 颜色归各品牌所有</p>
      </footer>
    </div>
  );
}