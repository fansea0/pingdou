import { useEffect, useRef } from 'react';
import type { Palette, PipelineResult } from '@/types';
import { renderPaletteImage } from '@/pipeline/renderer';

interface Props {
  result: PipelineResult | null;
  palette: Palette;
  previewCellPx: number;
  isRecomputing: boolean;
}

export function PreviewCanvas({ result, palette, previewCellPx, isRecomputing }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!result || !ref.current) return;
    const c = renderPaletteImage(result.indices, result.gridSize, palette, previewCellPx, '#ddd');
    const ctx = ref.current.getContext('2d')!;
    ref.current.width = c.width;
    ref.current.height = c.height;
    ctx.drawImage(c, 0, 0);
  }, [result, palette, previewCellPx]);

  return (
    <div className="preview-wrap">
      <canvas
        ref={ref}
        className={isRecomputing ? 'preview dim' : 'preview'}
      />
      {isRecomputing && <div className="overlay">计算中...</div>}
    </div>
  );
}
