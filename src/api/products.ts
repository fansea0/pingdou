const BASE = '/api';

export interface Product {
  id: number;
  name: string;
  image: string;
  price: number;        // 单位：分
  description: string;
  url: string;
  badge?: string;
  order: number;
}

export interface ProductPatch {
  name?: string;
  description?: string;
  price?: number;
  url?: string;
  badge?: string | null;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function listProducts(): Promise<Product[]> {
  const res = await fetch(`${BASE}/products`, { credentials: 'include' });
  return jsonOrThrow<Product[]>(res);
}

export async function updateProduct(id: number, patch: ProductPatch): Promise<Product> {
  const res = await fetch(`${BASE}/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    credentials: 'include',
  });
  return jsonOrThrow<Product>(res);
}

export async function uploadProductImage(id: number, file: File): Promise<Product> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${BASE}/products/${id}/image`, {
    method: 'POST',
    body: fd,
    credentials: 'include',
  });
  return jsonOrThrow<Product>(res);
}

export async function adminCreateProduct(product: Omit<Product, 'badge' | 'order'> & { badge?: string }): Promise<Product> {
  const res = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product),
    credentials: 'include',
  });
  return jsonOrThrow<Product>(res);
}

export async function adminDeleteProduct(id: number): Promise<{ ok: true }> {
  const res = await fetch(`${BASE}/products/${id}`, { method: 'DELETE', credentials: 'include' });
  return jsonOrThrow(res);
}

export async function adminReorderProducts(orderedIds: number[]): Promise<Product[]> {
  const res = await fetch(`${BASE}/admin/products/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds }),
    credentials: 'include',
  });
  const envelope = await jsonOrThrow<{ ok: true; products: Product[] }>(res);
  return envelope.products;
}