import { useEffect, useRef } from 'react';
import type { Palette, PipelineResult } from '@/types';
import { renderPaletteImage } from '@/pipeline/renderer';

interface Props {
  result: PipelineResult | null;
  palette: Palette;
  cellPx: number;
  zoom: number;
  panX: number;
  panY: number;
  onPan: (x: number, y: number) => void;
  isRecomputing: boolean;
}

/**
 * Apply zoom/pan transform to render source onto target canvas.
 * - Always fills background.
 * - When transform is identity (zoom=1, pan=0), draws directly without save/restore.
 * - When transform is non-identity, uses save/translate/scale/restore.
 *
 * Exported for unit testing without React.
 */
export function drawBeadCanvas(
  targetCtx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  zoom: number,
  panX: number,
  panY: number
): void {
  targetCtx.fillStyle = '#fafafa';
  targetCtx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);

  if (zoom === 1 && panX === 0 && panY === 0) {
    targetCtx.drawImage(sourceCanvas, 0, 0);
    return;
  }

  targetCtx.save();
  targetCtx.translate(panX, panY);
  targetCtx.scale(zoom, zoom);
  targetCtx.drawImage(sourceCanvas, 0, 0);
  targetCtx.restore();
}

export function PreviewCanvas({ result, palette, cellPx, zoom, panX, panY, onPan, isRecomputing }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  useEffect(() => {
    if (!result || !ref.current) return;
    const c = renderPaletteImage(result.indices, result.gridSize, palette, cellPx, '#ddd');
    const ctx = ref.current.getContext('2d')!;
    ref.current.width = c.width;
    ref.current.height = c.height;
    drawBeadCanvas(ctx, c, zoom, panX, panY);
  }, [result, palette, cellPx, zoom, panX, panY]);

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (zoom === 1) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: panX,
      baseY: panY,
    };
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    onPan(dragRef.current.baseX + dx, dragRef.current.baseY + dy);
  };

  const onMouseUp = () => {
    dragRef.current = null;
  };

  const cursor = zoom === 1 ? 'default' : 'grab';

  return (
    <div className="preview-wrap">
      <div className={isRecomputing ? 'preview-scroll dim' : 'preview-scroll'}>
        <canvas
          ref={ref}
          className="preview"
          style={{ cursor }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
      </div>
      {isRecomputing && <div className="overlay">计算中...</div>}
    </div>
  );
}