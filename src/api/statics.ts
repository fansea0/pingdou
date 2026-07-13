const BASE = '/api';

export interface HealthStatus {
  ok: boolean;
  staticsConfigured: boolean;
}

export interface Summary {
  totals: {
    pageView: number;
    productClick: number;
    imageExport: number;
    uv: number;
  };
  perDay: { day: string; total: number }[];
  productClicks: { ref: string; total: number }[];
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

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${BASE}/health`, { credentials: 'include' });
  return jsonOrThrow<HealthStatus>(res);
}

export async function login(password: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'include',
  });
  return jsonOrThrow<void>(res);
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

export async function fetchSummary(days: number): Promise<Summary> {
  const res = await fetch(`${BASE}/statics/summary?days=${days}`, {
    credentials: 'include',
  });
  return jsonOrThrow<Summary>(res);
}

export function trackEvent(
  kind: 'page-view' | 'product-click' | 'image-export',
  ref?: string,
  sid?: string
): void {
  const body = JSON.stringify({ kind, ref, sid });
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon('/api/track', blob);
    return;
  }
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    credentials: 'include',
    keepalive: true,
  }).catch(() => {});
}