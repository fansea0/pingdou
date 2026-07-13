import { useEffect } from 'react';
import { trackEvent } from '@/api/statics';
import { getSessionId } from '@/hooks/useSessionId';

export function usePageView() {
  useEffect(() => {
    const sid = getSessionId();
    trackEvent('page-view', undefined, sid);
    fetch('/api/session/touch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid }),
      keepalive: true,
    }).catch(() => {});
  }, []);
}

export function trackProductClick(productId: string) {
  trackEvent('product-click', productId, getSessionId() || undefined);
}

export function trackImageExport() {
  trackEvent('image-export', undefined, getSessionId() || undefined);
}