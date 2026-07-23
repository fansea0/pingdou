const BASE = '/api';

export interface HealthStatus {
  ok: boolean;
  staticsConfigured: boolean;
}

export interface Me {
  id: number;
  username: string;
  role: 'admin' | 'merchant';
  mustChangePassword: boolean;
  expiresAt: number | null;
}

export interface LoginResult extends Me { ok: true; }

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

export async function loginWithUsername(username: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    credentials: 'include',
  });
  return jsonOrThrow<LoginResult>(res);
}

export async function fetchMe(): Promise<Me> {
  const res = await fetch(`${BASE}/auth/me`, { credentials: 'include' });
  return jsonOrThrow<Me>(res);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
    credentials: 'include',
  });
  return jsonOrThrow<void>(res);
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
}

export interface AdminSummary {
  totals: { pageView: number; productClick: number; imageExport: number; uv: number };
  perDay: { day: string; total: number }[];
  productClicks: { ref: string; total: number }[];
}

export interface MerchantSummary {
  totals: { pageView: number; myClicks: number; productCount: number };
  perDay: { day: string; myClicks: number }[];
  productBreakdown: { productId: string; total: number }[];
}

export async function fetchSummary(days: number, _role: 'admin' | 'merchant'): Promise<AdminSummary | MerchantSummary> {
  void _role;
  const res = await fetch(`${BASE}/statics/summary?days=${days}`, { credentials: 'include' });
  return jsonOrThrow<AdminSummary | MerchantSummary>(res);
}

export interface PublicTotals {
  pv: number;
  exports: number;
}

export async function fetchPublicTotals(): Promise<PublicTotals> {
  const res = await fetch(`${BASE}/statics/public`, { credentials: 'omit' });
  return jsonOrThrow<PublicTotals>(res);
}

export function trackEvent(
  kind: 'page-view' | 'product-click' | 'image-export',
  ref?: string,
  sid?: string,
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