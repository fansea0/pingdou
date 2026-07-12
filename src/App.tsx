import { useMemo, useState } from 'react';
import { usePalette } from '@/hooks/usePalette';
import { usePipeline } from '@/hooks/usePipeline';
import { UploadZone } from '@/components/UploadZone';
import { ParamPanel } from '@/components/ParamPanel';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import { ColorLegend } from '@/components/ColorLegend';
import { ExportPanel } from '@/components/ExportPanel';
import { computeLegend } from '@/pipeline/legend';

const PREVIEW_CELL_PX = 24;

export function App() {
  const { palette, error: paletteError } = usePalette();
  const { status, result, error, process, reprocess, exportComposite } = usePipeline(palette);
  const [gridSize, setGridSize] = useState(100);
  const [enableDither, setEnableDither] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const legend = useMemo(
    () => (result && palette ? computeLegend(result.indices, palette) : []),
    [result, palette]
  );

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
      await exportComposite();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>拼豆图生成器</h1>
        <p className="subtitle">上传图片 → 生成可打印拼豆图（MARD {palette.length} 色）</p>
      </header>

      {error && <p className="error">处理异常：{error.message}</p>}

      <main className="layout-3col">
        <aside className="left">
          <UploadZone onLoad={(data) => process(data, { gridSize, enableDither })} />
          <ParamPanel
            gridSize={gridSize}
            onGridSizeChange={n => {
              setGridSize(n);
              setHighlightedIndex(null);
              reprocess({ gridSize: n, enableDither });
            }}
            enableDither={enableDither}
            onDitherChange={b => {
              setEnableDither(b);
              setHighlightedIndex(null);
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
            highlightedIndex={highlightedIndex}
            isRecomputing={status === 'recomputing'}
          />
        </section>

        <aside className="right">
          <ColorLegend
            legend={legend}
            highlightedIndex={highlightedIndex}
            onHoverIndex={setHighlightedIndex}
          />
        </aside>
      </main>
    </div>
  );
}
