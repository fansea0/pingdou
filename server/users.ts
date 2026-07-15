import { hashPassword, verifyPassword } from './passwords.js';
import { queryAll, runStmt } from './db.js';

export interface UserRow {
  id: number;
  username: string;
  passwordHash: string;
  role: 'admin' | 'merchant';
  disabled: number;
  mustChangePassword: number;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function now(): number { return Date.now(); }

function mapUser(row: Record<string, unknown>): UserRow {
  return {
    id: Number(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    role: row.role as 'admin' | 'merchant',
    disabled: Number(row.disabled ?? 0),
    mustChangePassword: Number(row.must_change_password ?? 0),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: 'admin' | 'merchant';
  expiresAt?: number | null;
  mustChangePassword?: boolean;
}

export function createUser(input: CreateUserInput): UserRow {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(input.username)) {
    throw new Error('invalid username');
  }
  if (input.password.length < 4) {
    throw new Error('password too short');
  }
  const ts = now();
  runStmt(
    `INSERT INTO users (username, password_hash, role, disabled, must_change_password, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      input.username,
      hashPassword(input.password),
      input.role,
      input.mustChangePassword ? 1 : 0,
      input.expiresAt ?? null,
      ts,
      ts,
    ]
  );
  const u = getUserByUsername(input.username);
  if (!u) throw new Error('createUser: missing after insert');
  return u;
}

export function getUserByUsername(username: string): UserRow | null {
  const rows = queryAll<Record<string, unknown>>(
    `SELECT * FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export function getUserById(id: number): UserRow | null {
  const rows = queryAll<Record<string, unknown>>(`SELECT * FROM users WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export function listUsers(): UserRow[] {
  const rows = queryAll<Record<string, unknown>>(`SELECT * FROM users ORDER BY id ASC`);
  return rows.map(mapUser);
}

export function countAdmins(): number {
  const rows = queryAll<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role='admin'`);
  return rows[0]?.n ?? 0;
}

export function setUserDisabled(id: number, disabled: boolean): void {
  runStmt(`UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?`,
    [disabled ? 1 : 0, now(), id]);
}

export function setUserPassword(id: number, newPassword: string): void {
  if (newPassword.length < 4) throw new Error('password too short');
  runStmt(
    `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
    [hashPassword(newPassword), now(), id]
  );
}

export function setUserMustChangePassword(id: number, must: boolean): void {
  runStmt(`UPDATE users SET must_change_password = ?, updated_at = ? WHERE id = ?`,
    [must ? 1 : 0, now(), id]);
}

export function setUserExpiresAt(id: number, expiresAt: number | null): void {
  runStmt(`UPDATE users SET expires_at = ?, updated_at = ? WHERE id = ?`,
    [expiresAt, now(), id]);
}

export function updateUser(id: number, patch: {
  disabled?: boolean;
  password?: string;
  mustChangePassword?: boolean;
  expiresAt?: number | null;
}): UserRow | null {
  if (patch.password !== undefined) setUserPassword(id, patch.password);
  if (patch.disabled !== undefined) setUserDisabled(id, patch.disabled);
  if (patch.mustChangePassword !== undefined) setUserMustChangePassword(id, patch.mustChangePassword);
  if (patch.expiresAt !== undefined) setUserExpiresAt(id, patch.expiresAt);
  return getUserById(id);
}

export function deleteUser(id: number): void {
  const u = getUserById(id);
  if (!u) return;
  if (u.role === 'admin' && countAdmins() <= 1) {
    throw new Error('cannot delete the last admin');
  }
  runStmt(`DELETE FROM users WHERE id = ?`, [id]);
}

export function checkUserPassword(id: number, plain: string): boolean {
  const u = getUserById(id);
  if (!u) return false;
  return verifyPassword(plain, u.passwordHash);
}

export function seedDefaultAdminIfEmpty(): UserRow | null {
  const rows = queryAll<{ n: number }>(`SELECT COUNT(*) AS n FROM users`);
  if ((rows[0]?.n ?? 0) > 0) return null;
  const u = createUser({
    username: 'root',
    password: 'fansea0117',
    role: 'admin',
    expiresAt: null,
    mustChangePassword: false,
  });
  console.log('[pingdou-server] seeded default admin (root)');
  return u;
}
