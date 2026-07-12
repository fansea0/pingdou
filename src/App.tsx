import { useMemo, useState } from 'react';
import { usePalette } from '@/hooks/usePalette';
import { usePipeline } from '@/hooks/usePipeline';
import { UploadZone } from '@/components/UploadZone';
import { ParamPanel } from '@/components/ParamPanel';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import { ColorLegend } from '@/components/ColorLegend';
import { ExportPanel } from '@/components/ExportPanel';
import { AdSlot } from '@/components/AdSlot';
import { ProductShowcase } from '@/components/ProductShowcase';
import { computeLegend } from '@/pipeline/legend';
import './components/AdSlot.css';

const PREVIEW_CELL_PX = 24;

// 百度联盟推广位 ID（从百度联盟后台创建广告位后填入）
// 缺失时 AdSlot 显示占位框，不影响功能
const AD_SLOT_HEADER = import.meta.env.VITE_BAIDU_AD_SLOT_HEADER as string | undefined;
const AD_SLOT_SIDEBAR = import.meta.env.VITE_BAIDU_AD_SLOT_SIDEBAR as string | undefined;
const AD_SLOT_FOOTER = import.meta.env.VITE_BAIDU_AD_SLOT_FOOTER as string | undefined;

export function App() {
  const { palette, error: paletteError } = usePalette();
  const { status, result, error, process, reprocess, exportMulti } = usePipeline(palette);
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

  const handleExport = async (exportCellPx: number, extraGridSizes: number[]) => {
    if (!result || exporting) return;
    setExporting(true);
    try {
      await exportMulti(exportCellPx, extraGridSizes);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>拼豆图生成器</h1>
          <p className="subtitle">上传图片 → 生成可打印拼豆图（MARD {palette.length} 色）</p>
        </div>
        <AdSlot slotId={AD_SLOT_HEADER} width={728} height={90} position="header" />
      </header>

      {error && <p className="error">处理异常：{error.message}</p>}

      <main className="layout-3col">
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
            currentGridSize={result?.gridSize ?? 100}
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
          <AdSlot slotId={AD_SLOT_SIDEBAR} width={300} height={250} position="sidebar" />
        </aside>
      </main>

      <ProductShowcase />

      <AdSlot slotId={AD_SLOT_FOOTER} width={728} height={90} position="footer" />

      <footer className="app-footer">
        <p>拼豆图生成器 · MARD 色板 · 纯前端，无后端</p>
      </footer>
    </div>
  );
}