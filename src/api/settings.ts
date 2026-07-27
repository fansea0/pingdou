const BASE = '/api';

export interface SiteConfig {
  showProducts: boolean;
}

export interface SettingRow {
  key: string;
  value: string;
  updatedAt: number;
  updatedBy: string;
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

export async function fetchSiteConfig(): Promise<SiteConfig> {
  const res = await fetch(`${BASE}/config`);
  return jsonOrThrow<SiteConfig>(res);
}

export async function adminListSettings(): Promise<{ settings: SettingRow[] }> {
  const res = await fetch(`${BASE}/admin/settings`, { credentials: 'include' });
  return jsonOrThrow(res);
}

export async function adminPutSetting(key: string, value: string): Promise<{ ok: true; setting: SettingRow }> {
  const res = await fetch(`${BASE}/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
    credentials: 'include',
  });
  return jsonOrThrow(res);
}