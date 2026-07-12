# 拼豆图：购买拼豆商品展示模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "购买拼豆材料" product showcase section at the bottom of the App that fetches product data from a static JSON file and renders cards linking to external stores.

**Architecture:** Static `public/data/products.json` is fetched on mount by `useProducts` hook (returns `{ products, loading, error }`). `ProductShowcase` component renders a CSS-grid of `ProductCard` items, each an `<a target="_blank" rel="noopener noreferrer">`. Image fallback (color block) handled by `onError`. Component is self-contained — App.tsx only inserts `<ProductShowcase />` between `<main>` and `<footer>`.

**Tech Stack:** React 18, TypeScript, Vite 5, native `fetch`, Vitest, @testing-library/react, native CSS.

**Reference Spec:** `docs/superpowers/specs/2026-07-12-product-showcase-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `Product` interface |
| `public/data/products.json` | Create | Product data (3 sample items) |
| `public/products/README.md` | Create | Placeholder guide for image upload |
| `src/hooks/useProducts.ts` | Create | Fetch + loading/error state |
| `src/hooks/useProducts.test.ts` | Create | Vitest + RTL tests for hook |
| `src/components/ProductShowcase.tsx` | Create | Section + ProductCard component |
| `src/components/ProductShowcase.css` | Create | Grid + card styles |
| `src/components/ProductShowcase.test.tsx` | Create | RTL tests for section + card |
| `src/App.tsx` | Modify | Insert `<ProductShowcase />` between `<main>` and `<footer>` |

---

## Task 1: Add `Product` Type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Append the `Product` interface to `src/types.ts`**

Read the current file, then append at the end:

```ts
export interface Product {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly price: number;
  readonly currency: 'CNY';
  readonly description: string;
  readonly url: string;
  readonly badge?: string;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 48/48 pass (no behavior change yet).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): Product interface for 商品展示模块"
```

---

## Task 2: Create `products.json` Sample Data + README

**Files:**
- Create: `public/data/products.json`
- Create: `public/products/README.md`

- [ ] **Step 1: Create `public/data/products.json`**

```json
[
  {
    "id": "p-128-set",
    "name": "128 色 MARD 拼豆套装",
    "image": "/products/128-set.jpg",
    "price": 99.00,
    "currency": "CNY",
    "description": "包含 MARD 全 128 色，每包约 1000 颗",
    "url": "https://item.taobao.com/iid=REPLACE_ME_128",
    "badge": "热销"
  },
  {
    "id": "p-24-set",
    "name": "24 色入门套装",
    "image": "/products/24-set.jpg",
    "price": 29.90,
    "currency": "CNY",
    "description": "适合新手，颜色覆盖常用色",
    "url": "https://item.taobao.com/iid=REPLACE_ME_24"
  },
  {
    "id": "p-tools",
    "name": "拼豆工具套装",
    "image": "/products/tools.jpg",
    "price": 19.90,
    "currency": "CNY",
    "description": "折板 + 镊子 + 熨斗垫",
    "url": "https://item.taobao.com/iid=REPLACE_ME_TOOLS"
  }
]
```

- [ ] **Step 2: Create `public/products/README.md`**

```md
# 商品图片目录

把商品图片放到这里，文件名与 `public/data/products.json` 里 `image` 字段对应。

## 当前示例商品需要的图片：

- `128-set.jpg` — 128 色拼豆套装照片（建议 800x800 正方形）
- `24-set.jpg` — 24 色拼豆套装照片
- `tools.jpg` — 拼豆工具照片

## 占位说明

在你还没上传真实图片前，商品卡会显示色块占位 + 商品名 + 价格。
这是预期的 fallback 行为，不会报错。

## 上传后

- 把图片放进本目录
- 图片会被 Vite 自动打包进 `dist/products/`
- 商品卡自动显示真实图片
```

- [ ] **Step 3: Verify build picks up the JSON**

Run: `npm run build 2>&1 | grep -i "products\|error" | head -10`
Expected: build succeeds; `dist/data/products.json` will exist after build.

- [ ] **Step 4: Commit**

```bash
git add public/data/products.json public/products/README.md
git commit -m "feat(products): 示例商品数据 + 图片目录占位说明"
```

---

## Task 3: `useProducts` Hook + Tests

**Files:**
- Create: `src/hooks/useProducts.ts`
- Create: `src/hooks/useProducts.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useProducts.test.ts`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProducts } from '@/hooks/useProducts';

describe('useProducts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in loading state', () => {
    const { result } = renderHook(() => useProducts());
    expect(result.current.loading).toBe(true);
    expect(result.current.products).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('populates products on successful fetch', async () => {
    const mockData = [
      { id: 'p1', name: 'A', image: '/a.jpg', price: 10, currency: 'CNY', description: 'd', url: 'http://x' },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    } as Response);

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.products).toEqual(mockData);
    expect(result.current.error).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.products).toEqual([]);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('network');
  });

  it('sets error on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => { throw new Error('should not parse'); },
    } as Response);

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/404/);
  });

  it('does not setState after unmount', async () => {
    const mockData = [{ id: 'p1', name: 'A', image: '/a.jpg', price: 10, currency: 'CNY', description: 'd', url: 'http://x' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const { result, unmount } = renderHook(() => useProducts());
    unmount();
    await new Promise(r => setTimeout(r, 50));
    // No assertion needed; React will warn if setState fires after unmount.
    // Test passes if no warning is emitted.
    expect(result.current.loading).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test useProducts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `src/hooks/useProducts.ts`**

```ts
import { useEffect, useState } from 'react';
import type { Product } from '@/types';

export function useProducts(): {
  products: Product[];
  loading: boolean;
  error: Error | null;
} {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/data/products.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Product[]>;
      })
      .then(data => {
        if (cancelled) return;
        setProducts(data);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { products, loading, error };
}
```

- [ ] **Step 4: Run tests, verify passing**

Run: `npm test useProducts`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProducts.ts src/hooks/useProducts.test.ts
git commit -m "feat(hooks): useProducts fetch + loading/error state"
```

---

## Task 4: `ProductShowcase` + `ProductCard` + CSS

**Files:**
- Create: `src/components/ProductShowcase.tsx`
- Create: `src/components/ProductShowcase.css`

- [ ] **Step 1: Create `src/components/ProductShowcase.css`**

```css
/* === Product Showcase === */
.product-showcase {
  margin-top: var(--space-5);
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
.product-showcase-header {
  text-align: center;
  margin-bottom: var(--space-4);
}
.product-showcase-header h2 {
  font-size: var(--text-lg);
  font-weight: 600;
  margin-bottom: var(--space-1);
}
.product-showcase-header p {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.product-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}
@media (max-width: 900px) {
  .product-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .product-grid { grid-template-columns: 1fr; }
}
.product-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-surface);
  text-decoration: none;
  color: inherit;
  transition: transform 0.15s, box-shadow 0.15s;
}
.product-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.product-image {
  position: relative;
  aspect-ratio: 1 / 1;
  background: linear-gradient(135deg, var(--color-surface-alt) 0%, var(--color-accent-soft) 100%);
  overflow: hidden;
}
.product-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.product-image.placeholder::before {
  content: attr(data-fallback);
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: 500;
}
.product-badge {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  background: var(--color-accent);
  color: white;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: 600;
}
.product-info {
  padding: var(--space-3);
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.product-name {
  font-size: var(--text-base);
  font-weight: 600;
}
.product-desc {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.4;
  flex: 1;
}
.product-price {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-accent);
}
.product-loading,
.product-error {
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  padding: var(--space-5);
}
.product-error {
  color: var(--color-error-fg);
}
```

- [ ] **Step 2: Create `src/components/ProductShowcase.tsx`**

```tsx
import type { Product } from '@/types';
import { useProducts } from '@/hooks/useProducts';
import './ProductShowcase.css';

export function ProductShowcase() {
  const { products, loading, error } = useProducts();

  if (loading) {
    return (
      <section className="product-showcase">
        <p className="product-loading">商品加载中...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="product-showcase">
        <p className="product-error">商品信息加载失败</p>
      </section>
    );
  }

  if (products.length === 0) return null;

  return (
    <section className="product-showcase">
      <header className="product-showcase-header">
        <h2>购买拼豆材料</h2>
        <p>基于 MARD 色板，一站式购齐</p>
      </header>
      <div className="product-grid">
        {products.map(p => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <a
      className="product-card"
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="product-image" data-fallback={product.name}>
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          onError={(e) => {
            const img = e.currentTarget;
            img.style.display = 'none';
            img.parentElement!.classList.add('placeholder');
          }}
        />
        {product.badge && <span className="product-badge">{product.badge}</span>}
      </div>
      <div className="product-info">
        <h3 className="product-name">{product.name}</h3>
        <p className="product-desc">{product.description}</p>
        <div className="product-price">¥{product.price.toFixed(2)}</div>
      </div>
    </a>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ProductShowcase.tsx src/components/ProductShowcase.css
git commit -m "feat(ui): ProductShowcase 网格 + ProductCard 跳转外链"
```

---

## Task 5: `ProductShowcase` Tests

**Files:**
- Create: `src/components/ProductShowcase.test.tsx`

- [ ] **Step 1: Create `src/components/ProductShowcase.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { ProductShowcase } from '@/components/ProductShowcase';

const mockProducts = [
  { id: 'p1', name: '128 色套装', image: '/a.jpg', price: 99, currency: 'CNY' as const, description: '套装介绍', url: 'https://taobao.com/1' },
  { id: 'p2', name: '24 色套装', image: '/b.jpg', price: 29.9, currency: 'CNY' as const, description: '入门套装', url: 'https://taobao.com/2', badge: '新品' },
];

describe('ProductShowcase', () => {
  it('shows loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<ProductShowcase />);
    expect(container.querySelector('.product-loading')).toBeTruthy();
  });

  it('renders one card per product', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockProducts,
    } as Response);

    const { container } = render(<ProductShowcase />);
    await waitFor(() => expect(container.querySelectorAll('.product-card')).toHaveLength(2));
  });

  it('renders product name, price, badge', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockProducts,
    } as Response);

    render(<ProductShowcase />);
    await waitFor(() => screen.getByText('128 色套装'));
    expect(screen.getByText('128 色套装')).toBeTruthy();
    expect(screen.getByText('¥99.00')).toBeTruthy();
    expect(screen.getByText('新品')).toBeTruthy();
  });

  it('shows error state on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));
    const { container } = render(<ProductShowcase />);
    await waitFor(() => expect(container.querySelector('.product-error')).toBeTruthy());
  });

  it('renders nothing for empty product list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    const { container } = render(<ProductShowcase />);
    await waitFor(() => expect(container.querySelector('.product-grid')).toBeNull());
  });
});

describe('ProductCard', () => {
  it('sets correct anchor attributes for safety', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockProducts,
    } as Response);

    const { container } = render(<ProductShowcase />);
    await waitFor(() => container.querySelectorAll('.product-card').length > 0);

    const firstCard = container.querySelector('.product-card') as HTMLAnchorElement;
    expect(firstCard.target).toBe('_blank');
    expect(firstCard.rel).toBe('noopener noreferrer');
    expect(firstCard.href).toContain('https://taobao.com/1');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test ProductShowcase`
Expected: 6/6 pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/ProductShowcase.test.tsx
git commit -m "test(ProductShowcase): 4 种状态 + 锚点安全属性"
```

---

## Task 6: Integrate into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Read current `src/App.tsx`**

Run: `cat src/App.tsx`

- [ ] **Step 2: Add `ProductShowcase` import and insert component**

In the import block at the top, add:

```tsx
import { ProductShowcase } from '@/components/ProductShowcase';
```

Find the closing `</main>` tag. After it (and before the `<footer>`), insert:

```tsx
      <ProductShowcase />
```

- [ ] **Step 3: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: 0 errors; 56/56 pass (48 + 8 new).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): App 插入 ProductShowcase 在 footer 上方"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run full unit suite**

Run: `npm test`
Expected: 56/56 pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: 0 errors. Verify:
```bash
ls dist/data/products.json dist/products/README.md 2>&1
```
Both should exist.

- [ ] **Step 4: Manual dev-server smoke test**

Run: `npm run dev` (background); visit http://localhost:5173; verify:
- Scroll to bottom of page → "购买拼豆材料" section visible
- 3 product cards shown
- Each card shows: image placeholder (color block + product name fallback text), name, description, price in ¥X.XX format
- Click a card → opens new tab to the placeholder URL
- Hover a card → slight lift + shadow appears
- Resize browser narrow → grid drops to 2 columns, then 1 column

Stop server with Ctrl+C after verifying.

- [ ] **Step 5: Verify deletion case**

Delete `public/data/products.json` (or rename it temporarily):
```bash
mv public/data/products.json public/data/products.json.bak
npm run dev
```
Refresh page → "商品信息加载失败" appears. Restore:
```bash
mv public/data/products.json.bak public/data/products.json
```

- [ ] **Step 6: Git log review**

Run: `git log --oneline | head -10`
Expected: 6 new commits since `f7a4e31` (the spec commit):
1. `feat(types): Product interface`
2. `feat(products): 示例商品数据 + 图片目录占位说明`
3. `feat(hooks): useProducts fetch + loading/error state`
4. `feat(ui): ProductShowcase 网格 + ProductCard 跳转外链`
5. `test(ProductShowcase): 4 种状态 + 锚点安全属性`
6. `feat(ui): App 插入 ProductShowcase 在 footer 上方`

---

## Self-Review

After writing this plan I checked against the spec:

**1. Spec coverage:**
- PS-1 (App 页底部展示) → Task 6 inserts `<ProductShowcase />` between `<main>` and `<footer>`
- PS-2 (点击跳外链 + 安全属性) → Task 4 sets `target="_blank" rel="noopener noreferrer"`; Task 5 tests them
- PS-3 (改 JSON 更新商品) → Task 2 creates JSON; whole plan uses build-time JSON consumption
- PS-4 (图片缺失占位) → Task 4 has `onError` + CSS `.placeholder` class
- PS-5 (主功能不受影响) → Task 6 only inserts, doesn't modify any existing code

**2. Placeholder scan:** No "TBD" / "TODO" / "implement later". Every step has full code or commands. Test code is complete.

**3. Type consistency:**
- `Product` interface in Task 1 matches what `useProducts` returns in Task 3 and what `ProductShowcase` consumes in Task 4
- `useProducts` return type `{ products, loading, error }` is consistent across Task 3, Task 4, Task 5

**4. Edge cases / gaps fixed during self-review:**
- Task 5 tests `loading` state by mocking fetch to return `new Promise(() => {})` (never resolves) so we can assert initial `loading: true` deterministically
- Task 4 uses `data-fallback` attribute on `.product-image` so CSS `::before` can render product name when image fails — this works without JS for the fallback
- Task 3 cleanup uses `cancelled` flag to prevent setState after unmount (React StrictMode safety)

**5. Test count progression:**
- Before this plan: 48 tests
- After Task 3 (useProducts): 53 (+5)
- After Task 5 (ProductShowcase): 59 (+6)
- Final: 59 unit tests

Plan is ready for execution.