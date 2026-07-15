import { useState } from 'react';
import { StatsTab } from './StatsTab';
import { UsersTab } from './UsersTab';
import { ProductsTab } from './ProductsTab';

type Tab = 'stats' | 'users' | 'products';

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('stats');

  return (
    <>
      <div className="statics-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'stats'} className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>统计</button>
        <button role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>账号</button>
        <button role="tab" aria-selected={tab === 'products'} className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>商品</button>
      </div>
      {tab === 'stats' && <StatsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'products' && <ProductsTab />}
    </>
  );
}