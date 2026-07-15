const BASE = '/api';

export type Role = 'admin' | 'merchant';

export interface AdminUserView {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  mustChangePassword: boolean;
  expiresAt: number | null;
  createdAt: number;
  products: string[];
}

export interface CreateUserPayload {
  username: string;
  password: string;
  role: Role;
  productIds?: string[];
  expiresAt?: number | null;
  mustChangePassword?: boolean;
}

export interface PatchUserPayload {
  password?: string;
  disabled?: boolean;
  mustChangePassword?: boolean;
  expiresAt?: number | null;
  productIds?: string[];
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

export async function adminListUsers(): Promise<AdminUserView[]> {
  const res = await fetch(`${BASE}/admin/users`, { credentials: 'include' });
  return jsonOrThrow<AdminUserView[]>(res);
}

export async function adminCreateUser(payload: CreateUserPayload): Promise<{ id: number; username: string; role: Role }> {
  const res = await fetch(`${BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

export async function adminPatchUser(id: number, payload: PatchUserPayload): Promise<{ ok: true }> {
  const res = await fetch(`${BASE}/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  return jsonOrThrow(res);
}

export async function adminDeleteUser(id: number): Promise<{ ok: true }> {
  const res = await fetch(`${BASE}/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
  return jsonOrThrow(res);
}

export async function adminResetPassword(id: number, newPassword: string): Promise<{ ok: true }> {
  const res = await fetch(`${BASE}/admin/users/${id}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
    credentials: 'include',
  });
  return jsonOrThrow(res);
}