import { useEffect, useRef } from 'react';
import type { Palette, PipelineResult } from '@/types';
import { renderPaletteImage } from '@/pipeline/renderer';

interface Props {
  result: PipelineResult | null;
  palette: Palette;
  cellPx: number;
  highlightedIndex: number | null;
  isRecomputing: boolean;
}

const HIGHLIGHT_COLOR = 'rgba(255, 235, 59, 0.55)';

export function PreviewCanvas({ result, palette, cellPx, highlightedIndex, isRecomputing }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!result || !ref.current) return;
    const c = renderPaletteImage(result.indices, result.gridSize, palette, cellPx, '#ddd');
    const ctx = ref.current.getContext('2d')!;
    ref.current.width = c.width;
    ref.current.height = c.height;
    ctx.drawImage(c, 0, 0);
  }, [result, palette, cellPx]);

  useEffect(() => {
    if (!result || !ref.current) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d')!;
    if (highlightedIndex === null) return;

    ctx.fillStyle = HIGHLIGHT_COLOR;
    for (let y = 0; y < result.gridSize; y++) {
      for (let x = 0; x < result.gridSize; x++) {
        if (result.indices[y * result.gridSize + x] === highlightedIndex) {
          ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
        }
      }
    }
  }, [result, palette, cellPx, highlightedIndex]);

  return (
    <div className="preview-wrap">
      <div className={isRecomputing ? 'preview-scroll dim' : 'preview-scroll'}>
        <canvas ref={ref} className="preview" />
      </div>
      {isRecomputing && <div className="overlay">计算中...</div>}
    </div>
  );
}
