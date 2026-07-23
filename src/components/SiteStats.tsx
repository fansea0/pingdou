import { useEffect, useState } from 'react';
import { fetchPublicTotals } from '@/api/statics';
import './SiteStats.css';

interface Snapshot {
  pv: number;
  exports: number;
}

function format(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

export function SiteStats() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPublicTotals()
      .then(totals => {
        if (cancelled) return;
        setSnapshot({ pv: totals.pv, exports: totals.exports });
      })
      .catch(() => {
        // silently ignore — stats are decorative
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!snapshot) return null;

  return (
    <p className="site-stats" aria-label="站点统计">
      <span>浏览 {format(snapshot.pv)}</span>
      <span className="site-stats-dot" aria-hidden="true">·</span>
      <span>导出 {format(snapshot.exports)}</span>
    </p>
  );
}