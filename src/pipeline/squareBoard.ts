import type { BackgroundMask, Palette } from '@/types';
import { renderAnnotatedImage } from './annotator';

/**
 * Renders a rectangular bead grid centered on a transparent square board.
 */
export function renderSquareBoard(
  indices: Uint8Array,
  outW: number,
  outH: number,
  palette: Palette,
  boardSize: number,
  cellPx: number,
  fontPx: number,
  mask: BackgroundMask | null = null
): HTMLCanvasElement {
  if (boardSize < 1 || !Number.isInteger(boardSize)) {
    throw new RangeError('boardSize must be a positive integer');
  }
  if (outW > boardSize || outH > boardSize) {
    throw new RangeError('boardSize must fit the sampled grid');
  }

  const boardPx = boardSize * cellPx;
  const source = renderAnnotatedImage(indices, outW, outH, palette, cellPx, fontPx, mask);
  const canvas = document.createElement('canvas');
  canvas.width = boardPx;
  canvas.height = boardPx;

  const ctx = canvas.getContext('2d')!;
  const x = Math.floor((boardPx - source.width) / 2);
  const y = Math.floor((boardPx - source.height) / 2);
  ctx.drawImage(source, x, y);
  ctx.strokeStyle = 'rgb(51,51,51)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, boardPx, boardPx);
  return canvas;
}
