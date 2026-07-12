import { useMemo, useState } from 'react';
import { usePalette } from '@/hooks/usePalette';
import { usePipeline } from '@/hooks/usePipeline';
import { useZoomPan } from '@/hooks/useZoomPan';
import { UploadZone } from '@/components/UploadZone';
import { ParamPanel } from '@/components/ParamPanel';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import { ColorLegend } from '@/components/ColorLegend';
import { ExportPanel } from '@/components/ExportPanel';
import { ZoomToolbar } from '@/components/ZoomToolbar';
import { computeLegend } from '@/pipeline/legend';

const PREVIEW_CELL_PX = 24;

export function App() {
  const { palette, error: paletteError } = usePalette();
  const { status, result, error, process, reprocess, exportComposite } = usePipeline(palette);
  const { zoom, panX, panY, setZoom, setPan, zoomIn, zoomOut, reset: resetZoom } = useZoomPan();
  const [gridSize, setGridSize] = useState(100);
  const [enableDither, setEnableDither] = useState(false);
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

  const onUpload = (data: ImageData) => {
    resetZoom();
    process(data, { gridSize, enableDither });
  };

  const onGridSizeChange = (n: number) => {
    setGridSize(n);
    resetZoom();
    reprocess({ gridSize: n, enableDither });
  };

  const onDitherChange = (b: boolean) => {
    setEnableDither(b);
    resetZoom();
    reprocess({ gridSize, enableDither: b });
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
          <UploadZone onLoad={onUpload} />
          <ParamPanel
            gridSize={gridSize}
            onGridSizeChange={onGridSizeChange}
            enableDither={enableDither}
            onDitherChange={onDitherChange}
            disabled={status === 'idle' || status === 'loading'}
          />
          <ExportPanel
            disabled={!result || exporting}
            onExport={handleExport}
          />
        </aside>

        <section className="middle">
          <div className="preview-container">
            <PreviewCanvas
              result={result}
              palette={palette}
              cellPx={PREVIEW_CELL_PX}
              zoom={zoom}
              panX={panX}
              panY={panY}
              onPan={setPan}
              isRecomputing={status === 'recomputing'}
            />
            <ZoomToolbar
              zoom={zoom}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onReset={resetZoom}
              onZoomChange={setZoom}
              disabled={!result}
            />
          </div>
        </section>

        <aside className="right">
          <ColorLegend legend={legend} />
        </aside>
      </main>
    </div>
  );
}