import { useCallback, useRef } from 'react';

interface Props {
  onLoad: (imageData: ImageData, bitmap: ImageBitmap) => void;
}

export function UploadZone({ onLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('请上传图片文件');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      if (!confirm('图片较大，可能处理较慢，是否继续？')) return;
    }
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    onLoad(imageData, bitmap);
  }, [onLoad]);

  return (
    <div
      className="upload-zone"
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button className="primary" onClick={() => inputRef.current?.click()}>
        选择图片
      </button>
      <p className="hint">或将图片拖到此处（建议 ≥ 200×200）</p>
    </div>
  );
}
