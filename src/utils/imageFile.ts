// 共享：商品图片上传前的客户端校验。
// 限制与 server 端 multer 配置保持一致 (server/index.ts)。
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_MB = MAX_PRODUCT_IMAGE_BYTES / 1024 / 1024;
export const ALLOWED_PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function formatImageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function validateProductImageFile(file: File): string | null {
  if (!ALLOWED_PRODUCT_IMAGE_TYPES.includes(file.type)) {
    return `不支持的图片格式（仅 jpeg / png / webp），当前：${file.type || '未知'}`;
  }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    return `图片过大：${formatImageBytes(file.size)}，上限 ${MAX_PRODUCT_IMAGE_MB} MB，请压缩后再上传`;
  }
  return null;
}
