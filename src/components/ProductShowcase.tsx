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
        <h2>购买拼豆材料</h2>
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
  return (
    <a
      className="product-card"
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackProductClick(product.id)}
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