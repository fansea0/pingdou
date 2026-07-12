# 拼豆图：购买拼豆商品展示模块 - 设计文档

- **日期**: 2026-07-12
- **作者**: 通过 brainstorming 流程生成
- **状态**: 待实施
- **依赖**: 已存在的 MVP（无新外部依赖）

## 一、需求文档

### 1.1 背景

MVP 完成后，用户希望利用拼豆图生成器的流量做"卖货"——玩家制作完拼豆图后引导到外部店铺购买材料。这不是 affiliate（联盟返利），是 **直接卖拼豆套装/工具** 的商业引流。

### 1.2 用户故事

| ID | 故事 | 验收 |
|----|------|------|
| PS-1 | 作为玩家，做完拼豆图后能看到"购买拼豆材料"推荐 | App 页底部出现 ProductShowcase 模块 |
| PS-2 | 作为玩家，点击商品卡能跳转到店铺购买 | 新标签打开 + rel 安全属性正确 |
| PS-3 | 作为运营者，改商品 JSON 即可更新产品 | `public/data/products.json` 改完重 build |
| PS-4 | 作为玩家，图片缺失也能看到商品信息 | onError 兜底显示色块占位 |
| PS-5 | 作为玩家，主功能永远不受商品模块影响 | 商品区在 main 之下、footer 之上 |

### 1.3 范围 / 非目标

**范围内**：
- `public/data/products.json` 商品数据源
- `public/products/` 商品图静态资源（占位）
- `useProducts` hook：fetch + 状态
- `ProductShowcase` 组件：网格渲染商品卡
- `ProductCard` 子组件：图 + 名称 + 价格 + 跳转
- App 页底部插入（在 `.app-footer` 上方）

**非目标（明确不做）**：
- ❌ 商品详情页（只跳外链）
- ❌ 加入购物车 / 订单管理
- ❌ 优惠券 / 折扣码
- ❌ 用户评论 / 评分
- ❌ 搜索 / 筛选 / 排序
- ❌ 关联推荐（"看了这张图需要这些颜色"）
- ❌ 会员价 / 阶梯定价
- ❌ 后台管理界面
- ❌ 微信扫码支付
- ❌ 联盟 API 跟踪 / 转化漏斗
- ❌ CDN 动态加载（保持纯静态）
- ❌ 商品价格实时变化 / 库存跟踪

### 1.4 成功标准

- App 页底部稳定展示商品区，不影响主功能
- 3-6 个商品以网格展示，每卡可点击跳转外链
- 商品数据 JSON 维护，build 后 dist/ 内含 products.json + images
- 图片缺失 → 占位色块，不破图
- typecheck 0 错误；npm test 现有 48 + 新增 ≥ 8 = ≥ 56 个通过
- npm run build 通过

## 二、实现方案

### 2.1 架构图

```
public/data/products.json  ← 商品列表（id/name/image/price/url/badge）
public/products/*.jpg       ← 商品图片（占位 + 用户替换）
        ↓
src/hooks/useProducts.ts   ← fetch + 状态管理
        ↓
src/components/ProductShowcase.tsx  ← 渲染容器 + ProductCard 网格
        ↓
App.tsx 在 <main> 后、<footer> 前插入 <ProductShowcase />
```

### 2.2 文件清单

| 路径 | 动作 | 责任 |
|------|------|------|
| `public/data/products.json` | 新建 | 商品数据（3-6 条示例） |
| `public/products/README.md` | 新建 | 占位说明 + 上传指南 |
| `src/types.ts` | 修改 | 新增 `Product` 接口 |
| `src/hooks/useProducts.ts` | 新建 | fetch + 状态 hook |
| `src/hooks/useProducts.test.ts` | 新建 | vitest + RTL 单测 |
| `src/components/ProductShowcase.tsx` | 新建 | 商品网格容器 |
| `src/components/ProductShowcase.css` | 新建 | 网格样式 |
| `src/components/ProductShowcase.test.tsx` | 新建 | 渲染 + ProductCard 单测 |
| `src/App.tsx` | 修改 | 插入 `<ProductShowcase />` |

### 2.3 接口签名

```ts
// src/types.ts
export interface Product {
  readonly id: string;                              // 'p-128-set'
  readonly name: string;                            // '128 色 MARD 拼豆套装'
  readonly image: string;                           // '/products/128-set.jpg'
  readonly price: number;                           // 99.00
  readonly currency: 'CNY';                         // 当前固定 CNY
  readonly description: string;                     // '包含 MARD 全 128 色'
  readonly url: string;                             // 'https://item.taobao.com/...'
  readonly badge?: string;                          // 可选 '热销' / '新品'
}

// src/hooks/useProducts.ts
export function useProducts(): {
  products: Product[];
  loading: boolean;
  error: Error | null;
};

// src/components/ProductShowcase.tsx
interface Props {
  // self-contained; 未来可加 title / maxItems 等
}
export function ProductShowcase(props?: Props): JSX.Element | null;
```

### 2.4 products.json 示例（3 个示例商品）

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

### 2.5 关键组件结构

```tsx
// src/components/ProductShowcase.tsx
export function ProductShowcase() {
  const { products, loading, error } = useProducts();

  if (loading) return <section className="product-showcase">加载中...</section>;
  if (error) return <section className="product-showcase error">商品信息加载失败</section>;
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
      <div className="product-image">
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

### 2.6 useProducts hook

```ts
import { useEffect, useState } from 'react';
import type { Product } from '@/types';

export function useProducts() {
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
        if (!cancelled) {
          setProducts(data);
          setLoading(false);
        }
      })
      .catch(e => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  return { products, loading, error };
}
```

### 2.7 视觉位置

```
┌────────────────────────────────────────┐
│  拼豆图生成器（标题）         [AD-1]    │
├────────────────────────────────────────┤
│  三列布局                              │
│  [左控制] [预览] [右色号]                │
├────────────────────────────────────────┤
│  ★ 购买拼豆材料 ★                      │  ← 新增 ProductShowcase
│  ┌────┐ ┌────┐ ┌────┐                  │
│  │卡1│ │卡2│ │卡3│                     │
│  └────┘ └────┘ └────┘                  │
├────────────────────────────────────────┤
│  footer                                │
└────────────────────────────────────────┘
```

## 三、数据存储

| 文件 | 用途 | 维护方式 |
|------|------|---------|
| `public/data/products.json` | 商品数据 | 手动编辑 + 重 build |
| `public/products/*.jpg` | 商品图片 | 上传替换 + 重 build |

无后端、无 IndexedDB、无 localStorage 存储商品信息。

## 四、TODO

### 4.1 实施任务

- [ ] `src/types.ts` 新增 Product 接口
- [ ] `src/hooks/useProducts.ts` + 单测 4 条
- [ ] `src/components/ProductShowcase.tsx` + 单测 4 条
- [ ] `src/components/ProductShowcase.css` 样式
- [ ] `src/App.tsx` 插入 `<ProductShowcase />`（在 footer 上方）
- [ ] `public/data/products.json` 3 个示例商品
- [ ] `public/products/README.md` 占位说明

### 4.2 验收清单

- [ ] useProducts 4 个单测通过
- [ ] ProductShowcase 4 个单测通过
- [ ] typecheck 0 错误
- [ ] npm test 现有 48 + 新增 8 = **≥ 56 个** 通过
- [ ] npm run build 通过（dist/data/products.json 存在）
- [ ] 浏览器手测商品卡正常显示 + 点击跳转

## 五、常量映射

| 常量 | 值 | 用途 |
|------|----|------|
| 货币 | 'CNY' | 当前固定 |
| 网格列数（桌面） | 3 | ≥1024px |
| 网格列数（平板） | 2 | 600-1024px |
| 网格列数（手机） | 1 | <600px |
| 卡片圆角 | var(--radius-md) | 与现有视觉一致 |
| 图片 aspect ratio | 1:1 | 商品图正方形占位 |

## 六、接口协议

### 6.1 不变的接口

- 所有 pipeline 模块
- 现有 4 个 UI 组件（UploadZone/ParamPanel/PreviewCanvas/ColorLegend/ExportPanel）
- `usePalette()` / `usePipeline()` / `useThrottle()`
- 颜色 API、算法 API

### 6.2 变更的接口

```ts
// src/types.ts: 新增
+ export interface Product { ... }
```

## 七、服务发布

无后端变更。沿用 Vite 静态构建 + 任意静态托管。
- 构建产物 `dist/`：
  - `dist/data/products.json`（新增）
  - `dist/products/*.jpg`（新增）
  - JS 增量 < 3KB gzipped（fetch + render）
- 缓存策略：JSON + 图片可强缓存（hash 命名 + immutable）

## 八、CR 点

- [ ] ProductShowcase 完全 self-contained，不影响主功能
- [ ] JSON 缺失/格式错误时显示降级提示，不破图
- [ ] 图片 onError 兜底显示色块 + 商品名
- [ ] 外链 `target="_blank" rel="noopener noreferrer"` 安全属性正确
- [ ] 图片 `loading="lazy"` 不阻塞首屏
- [ ] useEffect cleanup `cancelled` flag 防止 React StrictMode 双渲染 setState after unmount
- [ ] CSS 类名 namespace 化（`.product-showcase` 等），不污染现有样式
- [ ] 不引入新依赖

## 九、实施步骤

按"风险递增"顺序：

1. **types.ts 新增 Product**（最低风险，5 分钟）
2. **public/data/products.json + 占位**（数据准备）
3. **useProducts hook + 单测**（核心数据层）
4. **ProductShowcase + ProductCard + css**（UI 渲染层 + 单测）
5. **App.tsx 插入**（集成）
6. **浏览器手测**（验收）
7. **README 更新**（可选：说明如何维护商品）

---

## 自检（写完后再过一遍）

1. **占位符扫描**：无 TBD/TODO/待定项。✓
2. **内部一致性**：架构图 / 接口 / TODO / CR 全对齐。✓
3. **范围检查**：聚焦"商品展示 + 跳转"，单 spec 可落地。✓
4. **歧义检查**：
   - 商品 URL 是 placeholder `REPLACE_ME_*`，用户后续替换为真实淘宝/拼多多链接
   - 占位图片：用 `README.md` 占位说明，用户自己拍/找图替换
   - 货币固定 CNY（spec §5 明确）
5. **回归风险**：明确列出"不变"的接口；新增面在 7 个文件，纯加性变更。✓