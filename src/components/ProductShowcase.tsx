import { useCallback, useRef, useState } from 'react';
import type { Product } from '@/types';
import { useProducts } from '@/hooks/useProducts';
import { trackProductClick } from '@/hooks/useTracking';
import './ProductShowcase.css';

export function ProductShowcase() {
  const { products, loading, error } = useProducts();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / (el.scrollWidth / products.length));
    setActiveIdx(Math.max(0, Math.min(products.length - 1, idx)));
  }, [products.length]);

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
        {/* 《广告法》第十四条 + 《互联网广告管理办法》第九条：以知识介绍/
            体验分享推销商品并附加购买方式的，必须显著标明「广告」。
            监管口径里「标注了但消费者不易识别」同样算违规，所以这里跟标题
            同级、带边框，不用灰色小字糊弄过去。 */}
        <h2>
          购买拼豆材料
          <span className="ad-badge">广告</span>
        </h2>
        <p>基于 MARD 色板，一站式购齐</p>
      </header>
      <div className="product-grid" ref={scrollRef} onScroll={onScroll}>
        {products.map(p => <ProductCard key={p.id} product={p} />)}
      </div>
      <div className="product-dots">
        {products.map((_, i) => (
          <span key={i} className={`product-dot ${i === activeIdx ? 'active' : ''}`} />
        ))}
      </div>
    </section>
  );
}

function ProductCard({ product }: { product: Product }) {
  const clickable = !!product.url;
  const inner = (
    <>
      <div className="product-image" data-fallback={product.name}>
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          onError={(e) => {
            const img = e.currentTarget;
            // 防止 default 图也失败时进入 onerror 死循环
            if (img.dataset.fallbackApplied === '1') return;
            img.dataset.fallbackApplied = '1';
            img.src = '/static-data/default-product.png';
          }}
        />
        {product.badge && <span className="product-badge">{product.badge}</span>}
      </div>
      <div className="product-info">
        <h3 className="product-name">{product.name}</h3>
        <p className="product-desc">{product.description}</p>
        <div className="product-price">¥{(product.price / 100).toFixed(2)}</div>
      </div>
    </>
  );

  return clickable ? (
    <a
      className="product-card"
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackProductClick(String(product.id))}
    >
      {inner}
    </a>
  ) : (
    <div className="product-card" data-no-url>
      {inner}
    </div>
  );
}