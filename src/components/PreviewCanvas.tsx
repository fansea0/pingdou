import { useEffect, useRef } from 'react';
import type { Palette, PipelineResult } from '@/types';
import { renderPaletteImage } from '@/pipeline/renderer';

interface Props {
  result: PipelineResult | null;
  palette: Palette;
  cellPx: number;
  isRecomputing: boolean;
}

export function PreviewCanvas({ result, palette, cellPx, isRecomputing }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!result || !ref.current) return;
    const c = renderPaletteImage(result.indices, result.outW, result.outH, palette, cellPx, '#ddd');
    const ctx = ref.current.getContext('2d')!;
    ref.current.width = c.width;
    ref.current.height = c.height;
    ctx.drawImage(c, 0, 0);
  }, [result, palette, cellPx]);

  return (
    <div className="preview-wrap">
      <div className={isRecomputing ? 'preview-scroll dim' : 'preview-scroll'}>
        <canvas ref={ref} className="preview" />
      </div>
      {isRecomputing && <div className="overlay">计算中...</div>}
    </div>
  );
}