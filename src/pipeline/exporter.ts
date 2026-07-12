export interface ExportItem {
  readonly blob: Blob;
  readonly filename: string;
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

export async function exportTriptych(
  gridSize: number,
  canvasNoAnn: HTMLCanvasElement,
  canvasAnn: HTMLCanvasElement | null,
  recipeBlob: Blob
): Promise<void> {
  const png1 = await canvasToBlob(canvasNoAnn);
  triggerDownload(png1, `pingdou-${gridSize}x${gridSize}.png`);

  if (canvasAnn) {
    const png2 = await canvasToBlob(canvasAnn);
    triggerDownload(png2, `pingdou-${gridSize}x${gridSize}-annotated.png`);
  }

  triggerDownload(recipeBlob, `pingdou-${gridSize}x${gridSize}-recipe.csv`);
}
