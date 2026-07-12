import { useState } from 'react';
import { usePalette } from '@/hooks/usePalette';
import { usePipeline } from '@/hooks/usePipeline';
import { UploadZone } from '@/components/UploadZone';
import { ParamPanel } from '@/components/ParamPanel';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import { ExportPanel } from '@/components/ExportPanel';

export function App() {
  const { palette, error: paletteError } = usePalette();
  const { status, result, error, process, reprocess, exportTriptych } = usePipeline(palette);
  const [gridSize, setGridSize] = useState(100);
  const [enableDither, setEnableDither] = useState(false);
  const [previewCellPx] = useState(8);

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

  return (
    <div className="app">
      <header>
        <h1>拼豆图生成器</h1>
        <p className="subtitle">上传图片 → 生成可打印拼豆图（MARD {palette.length} 色）</p>
      </header>

      {error && <p className="error">处理异常：{error.message}</p>}

      <main className="layout">
        <aside className="left">
          <UploadZone onLoad={(data) => process(data, { gridSize, enableDither })} />
          <ParamPanel
            gridSize={gridSize}
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
            disabled={!result}
            onExport={exportTriptych}
          />
        </aside>

        <section className="right">
          <PreviewCanvas
            result={result}
            palette={palette}
            previewCellPx={previewCellPx}
            isRecomputing={status === 'recomputing'}
          />
        </section>
      </main>
    </div>
  );
}
