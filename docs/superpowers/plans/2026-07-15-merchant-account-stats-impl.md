# Multi-account analytics with merchant scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared `STATICS_PASSWORD` login on `/statics` with a per-user account system (one `root` admin + N merchants). Each merchant sees only their own products' click data and the global PV; admins get the full-fleet view plus user-management and full product CRUD. Existing cookies are cleared (cookie names stay the same so the browser just logs out once).

**Architecture:** Stand up three new tables (`users`, `product_assignments`, `auth_tokens`) on top of the existing `sql.js` `events`/`sessions` schema. Introduce a thin server module layout — `server/auth.ts` (scrypt hashing + token issuance/verification), `server/users.ts` (user CRUD + bootstrap), `server/assignments.ts` (assignment reconciliation in a single SQLite transaction), `server/products.ts` (products.json atomic read/write + image upload), and let `server/index.ts` become the composition layer. Frontend gets a new `src/api/{auth,users,products}.ts`, a role-aware `src/pages/StaticsPage.tsx` orchestrator, two new role dashboards under `src/pages/admin/` and `src/pages/merchant/`, and two shared modals (`ChangePasswordModal`, `ProductEditModal`).

**Tech Stack:** Express 5, sql.js (existing), Node `crypto.scryptSync` + `timingSafeEqual`, `multer` for multipart parsing, React 18, TypeScript, Vitest (jsdom), @testing-library/react, native CSS (existing variables).

**Reference Spec:** `docs/superpowers/specs/2026-07-15-merchant-account-stats-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `multer` + `@types/multer` + `supertest` + `@types/supertest` deps |
| `server/db.ts` | Modify | Add `users`, `product_assignments`, `auth_tokens` tables; add `runInTransaction` helper |
| `server/passwords.ts` | Create | scrypt hash/verify with format `scrypt$<saltHex>$<hashHex>` |
| `server/auth.ts` | Rewrite | DB-backed session tokens, replace legacy `STATICS_PASSWORD` |
| `server/users.ts` | Create | User CRUD + `seedDefaultAdminIfEmpty` |
| `server/assignments.ts` | Create | `reconcileAssignments` (transactional), `hasActiveAssignment`, etc. |
| `server/products.ts` | Create | `products.json` atomic writer + image upload + `requireProductAccess` helper |
| `server/index.ts` | Rewrite | Mount auth/user/product/summary routes; bootstrap default admin + product cache |
| `tests/unit/server/passwords.test.ts` | Create | scrypt round-trip + wrong password |
| `tests/unit/server/db-helpers.test.ts` | Create | `runInTransaction` commit/rollback; new tables exist after `initDb` |
| `tests/unit/server/users.test.ts` | Create | create/disable/password/count/seed/delete |
| `tests/unit/server/assignments.test.ts` | Create | reconcile + unique index + revoke-all-for-product |
| `tests/unit/server/products.test.ts` | Create | atomic write survives; round-trip create/update/delete |
| `tests/unit/server/auth-token.test.ts` | Create | issue/verify/clear session token |
| `tests/unit/server/routes-auth.test.ts` | Create | integration: login → me → logout; disabled rejected |
| `src/api/statics.ts` | Modify | Add `loginWithUsername`, `fetchMe`, `changePassword`; typed `Me` |
| `src/api/users.ts` | Create | admin user-management client |
| `src/api/products.ts` | Create | list/update/upload/create/delete client |
| `src/pages/StaticsPage.tsx` | Rewrite | Fetch `/auth/me` on load; route by role; handle 401; render `ChangePasswordModal required` |
| `src/pages/StaticsPage.css` | Modify | Add classes for tabs, modal-backdrop, change-password modal, product edit modal, user table |
| `src/pages/admin/AdminDashboard.tsx` | Create | Tabs: Stats / Users / Products |
| `src/pages/admin/StatsTab.tsx` | Create | Pure admin `Summary` renderer (extracted) |
| `src/pages/admin/UsersTab.tsx` | Create | User table + new-user modal + per-row actions |
| `src/pages/admin/ProductsTab.tsx` | Create | Full product table + create-product modal (admin only) |
| `src/pages/merchant/MerchantDashboard.tsx` | Create | Cards + per-day chart + per-product table with 编辑 buttons |
| `src/components/ChangePasswordModal.tsx` | Create | Required vs voluntary variants; backdrop blocks dismiss when required |
| `src/components/ChangePasswordModal.css` | Create | Styles for modal-backdrop |
| `src/components/ProductEditModal.tsx` | Create | Text fields + image upload via FormData |
| `src/components/ProductEditModal.css` | Create | Styles for product edit modal |
| `tests/unit/pages/StaticsPage.test.tsx` | Create | Renders login when no `/me`; renders change-password modal when `mustChangePassword=true`; routes to admin vs merchant |
| `tests/unit/pages/UsersTab.test.tsx` | Create | Modal opens on 新建账号 click |
| `tests/unit/pages/ProductEditModal.test.tsx` | Create | Image upload field renders with `accept="image/*"` |

---

## Task 1: Feature branch + add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Branch**

```bash
git checkout -b feature/merchant-account-stats
```

Expected: `Switched to a new branch 'feature/merchant-account-stats'`

- [ ] **Step 2: Install runtime and dev deps**

Run:
```bash
npm install multer@^1.4.5-lts.1 && npm install --save-dev @types/multer@^1.4.12 supertest@^7.0.0 @types/supertest@^6.0.2
```

Expected: `package.json` `dependencies` includes `"multer"` and `devDependencies` includes `@types/multer`, `supertest`, `@types/supertest`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(deps): add multer + supertest for product-image uploads and route tests"
```

---

## Task 2: `server/db.ts` — add new tables + transactional helper

**Files:**
- Modify: `server/db.ts:32-54` (extend the `db.exec()` block in `initDb`)
- Modify: `server/db.ts` (append `runInTransaction` helper near the other helpers)

- [ ] **Step 1: Write failing test for new tables**

Create `tests/unit/server/db-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshDbPath(): string {
  return join(tmpdir(), `stats-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('initDb new tables + runInTransaction', () => {
  it('creates users / product_assignments / auth_tokens tables after initDb', async () => {
    process.env.STATS_DB_PATH = freshDbPath();
    const { initDb, queryAll, flushNow } = await import('../../../server/db.js');
    await initDb();
    const tables = queryAll<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`);
    const names = tables.map(t => t.name);
    expect(names).toContain('users');
    expect(names).toContain('product_assignments');
    expect(names).toContain('auth_tokens');
    flushNow();
    if (existsSync(process.env.STATS_DB_PATH)) unlinkSync(process.env.STATS_DB_PATH);
  });

  it('runInTransaction commits when fn returns normally', async () => {
    process.env.STATS_DB_PATH = freshDbPath();
    const { initDb, runInTransaction, queryAll, flushNow } = await import('../../../server/db.js');
    await initDb();
    runInTransaction(() => {
      // no-op body: just confirm transaction boundaries work
    });
    expect(queryAll<{ n: number }>(`SELECT 1 AS n`).length).toBe(1);
    flushNow();
    if (existsSync(process.env.STATS_DB_PATH)) unlinkSync(process.env.STATS_DB_PATH);
  });

  it('runInTransaction rolls back when fn throws', async () => {
    process.env.STATS_DB_PATH = freshDbPath();
    const { initDb, runInTransaction, queryAll, flushNow } = await import('../../../server/db.js');
    await initDb();
    expect(() => runInTransaction(() => {
      throw new Error('boom');
    })).toThrow('boom');
    // sanity: connection still functional after rollback
    expect(queryAll<{ n: number }>(`SELECT 1 AS n`).length).toBe(1);
    flushNow();
    if (existsSync(process.env.STATS_DB_PATH)) unlinkSync(process.env.STATS_DB_PATH);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/server/db-helpers.test.ts`
Expected: FAIL with `users`/`product_assignments`/`auth_tokens` not found.

- [ ] **Step 3: Extend `db.exec` in `initDb`**

In `server/db.ts`, locate the `db.exec(\`...\`)` call inside `initDb()` (currently creates only `events` and `sessions`). Append three new table blocks + indexes inside that same `db.exec` call. The full new block must read:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref TEXT,
      created_at INTEGER NOT NULL,
      day TEXT NOT NULL,
      ip_hash TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_day ON events(day);
    CREATE INDEX IF NOT EXISTS idx_events_ref ON events(ref);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      day TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','merchant')),
      disabled INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_assignment
      ON product_assignments(product_id) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_assignments_user_active
      ON product_assignments(user_id, revoked_at);

    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
  `);
```

- [ ] **Step 4: Add `runInTransaction` helper**

In `server/db.ts`, immediately after the existing `queryAll` helper, append:

```ts
export function runInTransaction<T>(fn: () => T): T {
  const database = requireDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    try { database.exec('ROLLBACK'); } catch {}
    throw err;
  }
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run tests/unit/server/db-helpers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/db.ts tests/unit/server/db-helpers.test.ts
git commit -m "feat(db): add users/product_assignments/auth_tokens tables + runInTransaction"
```

---

## Task 3: `server/passwords.ts` — scrypt hash/verify

**Files:**
- Create: `server/passwords.ts`
- Create: `tests/unit/server/passwords.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/server/passwords.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../../server/passwords.js';

describe('passwords', () => {
  it('hashPassword returns a scrypt-prefixed string with two hex parts', () => {
    const h = hashPassword('fansea0117');
    expect(h.startsWith('scrypt$')).toBe(true);
    const rest = h.slice('scrypt$'.length);
    const parts = rest.split('$');
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it('verifyPassword accepts the correct plain', () => {
    const h = hashPassword('hello-world');
    expect(verifyPassword('hello-world', h)).toBe(true);
  });

  it('verifyPassword rejects the wrong plain', () => {
    const h = hashPassword('hello-world');
    expect(verifyPassword('goodbye', h)).toBe(false);
  });

  it('verifyPassword returns false for malformed stored hash', () => {
    expect(verifyPassword('anything', 'not-scrypt-format')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$$')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$aa$bb$cc')).toBe(false);
  });

  it('two hashes of the same password differ (random salt)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/server/passwords.test.ts`
Expected: FAIL `Cannot find module '../../../server/passwords.js'`.

- [ ] **Step 3: Implement `server/passwords.ts`**

Create `server/passwords.ts`:

```ts
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const rest = stored.slice('scrypt$'.length);
  const sep = rest.indexOf('$');
  if (sep === -1) return false;
  const saltHex = rest.slice(0, sep);
  const hashHex = rest.slice(sep + 1);
  if (saltHex.length === 0 || hashHex.length === 0) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const derived = scryptSync(plain, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run tests/unit/server/passwords.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/passwords.ts tests/unit/server/passwords.test.ts
git commit -m "feat(auth): scrypt-based password hash + verify"
```

---

## Task 4: `server/users.ts` — user CRUD + bootstrap

**Files:**
- Create: `server/users.ts`
- Create: `tests/unit/server/users.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/server/users.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshDbPath(): string {
  return join(tmpdir(), `users-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

async function freshDb() {
  process.env.STATS_DB_PATH = freshDbPath();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db;
}

function cleanup() {
  if (existsSync(process.env.STATS_DB_PATH!)) unlinkSync(process.env.STATS_DB_PATH!);
}

describe('users', () => {
  it('createUser inserts and getUserByUsername retrieves', async () => {
    const db = await freshDb();
    const { createUser, getUserByUsername } = await import('../../../server/users.js');
    const u = createUser({ username: 'alice', password: 'pw1234', role: 'merchant' });
    expect(u.id).toBeGreaterThan(0);
    const fetched = getUserByUsername('alice');
    expect(fetched?.username).toBe('alice');
    expect(fetched?.role).toBe('merchant');
    expect(fetched?.disabled).toBe(0);
    expect(fetched?.mustChangePassword).toBe(0);
    db.flushNow();
    cleanup();
  });

  it('duplicate username throws', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    createUser({ username: 'dup', password: 'pw1234', role: 'merchant' });
    expect(() => createUser({ username: 'dup', password: 'pw1234', role: 'merchant' })).toThrow();
    db.flushNow();
    cleanup();
  });

  it('setUserDisabled toggles the disabled flag', async () => {
    const db = await freshDb();
    const { createUser, setUserDisabled, getUserById } = await import('../../../server/users.js');
    const u = createUser({ username: 'bob', password: 'pw1234', role: 'merchant' });
    setUserDisabled(u.id, true);
    expect(getUserById(u.id)?.disabled).toBe(1);
    setUserDisabled(u.id, false);
    expect(getUserById(u.id)?.disabled).toBe(0);
    db.flushNow();
    cleanup();
  });

  it('setUserPassword replaces the hash; mustChangePassword stays as set', async () => {
    const db = await freshDb();
    const { createUser, setUserPassword, getUserById } = await import('../../../server/users.js');
    const u = createUser({ username: 'c', password: 'old', role: 'merchant', mustChangePassword: true });
    const oldHash = u.passwordHash;
    setUserPassword(u.id, 'newpw');
    const fetched = getUserById(u.id)!;
    expect(fetched.passwordHash).not.toBe(oldHash);
    expect(fetched.mustChangePassword).toBe(1);
    db.flushNow();
    cleanup();
  });

  it('seedDefaultAdminIfEmpty inserts root once and is idempotent', async () => {
    const db = await freshDb();
    const { seedDefaultAdminIfEmpty, getUserByUsername } = await import('../../../server/users.js');
    seedDefaultAdminIfEmpty();
    seedDefaultAdminIfEmpty();
    const root = getUserByUsername('root');
    expect(root?.role).toBe('admin');
    expect(root?.expiresAt).toBeNull();
    db.flushNow();
    cleanup();
  });

  it('seedDefaultAdminIfEmpty does nothing when another user exists', async () => {
    const db = await freshDb();
    const { createUser, seedDefaultAdminIfEmpty, getUserByUsername } = await import('../../../server/users.js');
    createUser({ username: 'preset-admin', password: 'pw', role: 'admin' });
    seedDefaultAdminIfEmpty();
    expect(getUserByUsername('root')).toBeNull();
    db.flushNow();
    cleanup();
  });

  it('deleteUser removes the row', async () => {
    const db = await freshDb();
    const { createUser, deleteUser, getUserById } = await import('../../../server/users.js');
    const u = createUser({ username: 'gone', password: 'pw', role: 'merchant' });
    deleteUser(u.id);
    expect(getUserById(u.id)).toBeNull();
    db.flushNow();
    cleanup();
  });

  it('deleteUser refuses to delete the last admin', async () => {
    const db = await freshDb();
    const { seedDefaultAdminIfEmpty, deleteUser, getUserByUsername } = await import('../../../server/users.js');
    seedDefaultAdminIfEmpty();
    const root = getUserByUsername('root')!;
    expect(() => deleteUser(root.id)).toThrow(/last admin/i);
    db.flushNow();
    cleanup();
  });

  it('countAdmins returns admin total', async () => {
    const db = await freshDb();
    const { createUser, countAdmins } = await import('../../../server/users.js');
    createUser({ username: 'a1', password: 'pw', role: 'admin' });
    createUser({ username: 'a2', password: 'pw', role: 'admin' });
    createUser({ username: 'm1', password: 'pw', role: 'merchant' });
    expect(countAdmins()).toBe(2);
    db.flushNow();
    cleanup();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/server/users.test.ts`
Expected: FAIL module not found.

- [ ] **Step 3: Implement `server/users.ts`**

Create `server/users.ts`:

```ts
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
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run tests/unit/server/users.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add server/users.ts tests/unit/server/users.test.ts
git commit -m "feat(users): user CRUD + bootstrap default root admin"
```

---

## Task 5: `server/assignments.ts` — reconcile product ownership

**Files:**
- Create: `server/assignments.ts`
- Create: `tests/unit/server/assignments.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/server/assignments.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshDbPath(): string {
  return join(tmpdir(), `assign-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

async function freshDb() {
  process.env.STATS_DB_PATH = freshDbPath();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db;
}

function cleanup() {
  if (existsSync(process.env.STATS_DB_PATH!)) unlinkSync(process.env.STATS_DB_PATH!);
}

describe('assignments', () => {
  it('reconcileAssignments inserts new + revokes removed + keeps intersection', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments, getActiveAssignmentsForUser, hasActiveAssignment } = await import('../../../server/assignments.js');
    const u = createUser({ username: 'm', password: 'pw', role: 'merchant' });

    reconcileAssignments(u.id, ['a', 'b']);
    expect(getActiveAssignmentsForUser(u.id).map(a => a.productId).sort()).toEqual(['a', 'b']);

    reconcileAssignments(u.id, ['b', 'c']);
    const active = getActiveAssignmentsForUser(u.id);
    expect(active.map(a => a.productId).sort()).toEqual(['b', 'c']);
    expect(hasActiveAssignment(u.id, 'a')).toBe(false);
    expect(hasActiveAssignment(u.id, 'b')).toBe(true);
    expect(hasActiveAssignment(u.id, 'c')).toBe(true);

    db.flushNow();
    cleanup();
  });

  it('unique index prevents two merchants holding the same product active at once', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments } = await import('../../../server/assignments.js');
    const u1 = createUser({ username: 'u1', password: 'pw', role: 'merchant' });
    const u2 = createUser({ username: 'u2', password: 'pw', role: 'merchant' });

    reconcileAssignments(u1.id, ['shared']);
    expect(() => reconcileAssignments(u2.id, ['shared'])).toThrow();

    db.flushNow();
    cleanup();
  });

  it('reconcileAssignments is idempotent on a no-op call', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments, getActiveAssignmentsForUser } = await import('../../../server/assignments.js');
    const u = createUser({ username: 'm', password: 'pw', role: 'merchant' });
    reconcileAssignments(u.id, ['a']);
    reconcileAssignments(u.id, ['a']); // no-op
    expect(getActiveAssignmentsForUser(u.id).length).toBe(1);
    db.flushNow();
    cleanup();
  });

  it('revokeAllForProduct ends every active row for that product', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { reconcileAssignments, revokeAllForProduct, hasActiveAssignment } = await import('../../../server/assignments.js');
    const u = createUser({ username: 'm', password: 'pw', role: 'merchant' });
    reconcileAssignments(u.id, ['a', 'b']);
    revokeAllForProduct('a');
    expect(hasActiveAssignment(u.id, 'a')).toBe(false);
    expect(hasActiveAssignment(u.id, 'b')).toBe(true);

    db.flushNow();
    cleanup();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/server/assignments.test.ts`
Expected: FAIL module not found.

- [ ] **Step 3: Implement `server/assignments.ts`**

Create `server/assignments.ts`:

```ts
import { queryAll, runStmt, runInTransaction } from './db.js';

export interface AssignmentRow {
  id: number;
  productId: string;
  userId: number;
  assignedAt: number;
  revokedAt: number | null;
}

function map(r: Record<string, unknown>): AssignmentRow {
  return {
    id: Number(r.id),
    productId: String(r.product_id),
    userId: Number(r.user_id),
    assignedAt: Number(r.assigned_at),
    revokedAt: r.revoked_at == null ? null : Number(r.revoked_at),
  };
}

export function getActiveAssignmentsForUser(userId: number): AssignmentRow[] {
  const rows = queryAll<Record<string, unknown>>(
    `SELECT * FROM product_assignments WHERE user_id = ? AND revoked_at IS NULL ORDER BY product_id`,
    [userId]
  );
  return rows.map(map);
}

export function hasActiveAssignment(userId: number, productId: string): boolean {
  const rows = queryAll<{ n: number }>(
    `SELECT COUNT(*) AS n FROM product_assignments
       WHERE user_id = ? AND product_id = ? AND revoked_at IS NULL`,
    [userId, productId]
  );
  return (rows[0]?.n ?? 0) > 0;
}

export function reconcileAssignments(userId: number, newProductIds: readonly string[]): void {
  const ts = Date.now();
  const unique = Array.from(new Set(newProductIds));
  runInTransaction(() => {
    const current = getActiveAssignmentsForUser(userId).map(a => a.productId);
    const currentSet = new Set(current);
    const newSet = new Set(unique);

    const toRevoke = current.filter(pid => !newSet.has(pid));
    if (toRevoke.length > 0) {
      const placeholders = toRevoke.map(() => '?').join(',');
      runStmt(
        `UPDATE product_assignments SET revoked_at = ?
           WHERE user_id = ? AND product_id IN (${placeholders}) AND revoked_at IS NULL`,
        [ts, userId, ...toRevoke]
      );
    }

    const toAdd = unique.filter(pid => !currentSet.has(pid));
    for (const pid of toAdd) {
      runStmt(
        `INSERT INTO product_assignments (product_id, user_id, assigned_at, revoked_at)
         VALUES (?, ?, ?, NULL)`,
        [pid, userId, ts]
      );
    }
  });
}

export function revokeAllForProduct(productId: string): void {
  const ts = Date.now();
  runStmt(
    `UPDATE product_assignments SET revoked_at = ?
       WHERE product_id = ? AND revoked_at IS NULL`,
    [ts, productId]
  );
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run tests/unit/server/assignments.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/assignments.ts tests/unit/server/assignments.test.ts
git commit -m "feat(assignments): transactional reconcile for product ownership"
```

---

## Task 6: `server/products.ts` — products.json cache + atomic write + image upload

**Files:**
- Create: `server/products.ts`
- Create: `tests/unit/server/products.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/server/products.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;
let origCwd: string;
let origEnv: string | undefined;

function fixture() {
  tmp = mkdtempSync(join(tmpdir(), 'products-test-'));
  origCwd = process.cwd();
  origEnv = process.env.PRODUCTS_JSON_PATH;
  process.chdir(tmp);
  const dataDir = join(tmp, 'public', 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, 'products.json'),
    JSON.stringify([
      { id: 'a', name: 'A', image: '', price: 1, currency: 'CNY', description: '', url: '' },
      { id: 'b', name: 'B', image: '', price: 2, currency: 'CNY', description: '', url: '' },
    ])
  );
  // ensure products cache reloads
  delete require.cache[require.resolve('../../../server/products.js')];
}

function teardown() {
  process.chdir(origCwd);
  if (origEnv === undefined) delete process.env.PRODUCTS_JSON_PATH;
  else process.env.PRODUCTS_JSON_PATH = origEnv;
  rmSync(tmp, { recursive: true, force: true });
}

describe('products module', () => {
  beforeEach(fixture);
  afterEach(teardown);

  it('loadProductsCache + getProductById work on first load', async () => {
    const { loadProductsCache, getProductById } = await import('../../../server/products.js');
    loadProductsCache();
    expect(getProductById('a')?.name).toBe('A');
    expect(getProductById('does-not-exist')).toBeNull();
  });

  it('updateProduct writes atomically and updates cache', async () => {
    const { loadProductsCache, updateProduct, getProductById } = await import('../../../server/products.js');
    loadProductsCache();
    updateProduct('a', { name: 'A renamed', price: 5 });
    const a = getProductById('a');
    expect(a?.name).toBe('A renamed');
    expect(a?.price).toBe(5);

    const onDisk = JSON.parse(readFileSync(join(tmp, 'public/data/products.json'), 'utf-8'));
    expect(onDisk.find((p: { id: string }) => p.id === 'a').name).toBe('A renamed');

    expect(existsSync(join(tmp, 'public/data/products.json.tmp'))).toBe(false);
  });

  it('createProduct + deleteProduct round-trip', async () => {
    const { loadProductsCache, createProduct, deleteProduct, getProductById } = await import('../../../server/products.js');
    loadProductsCache();
    createProduct({ id: 'c', name: 'C', image: '', price: 3, currency: 'CNY', description: '', url: '' });
    expect(getProductById('c')?.name).toBe('C');
    deleteProduct('c');
    expect(getProductById('c')).toBeNull();
  });

  it('deleteProduct throws on missing product', async () => {
    const { loadProductsCache, deleteProduct } = await import('../../../server/products.js');
    loadProductsCache();
    expect(() => deleteProduct('does-not-exist')).toThrow(/not found/i);
  });

  it('createProduct rejects an invalid id', async () => {
    const { loadProductsCache, createProduct } = await import('../../../server/products.js');
    loadProductsCache();
    expect(() => createProduct({ id: 'BAD ID!', name: 'X', image: '', price: 0, currency: 'CNY', description: '', url: '' })).toThrow(/invalid product id/i);
  });

  it('replaceProductImage writes a new image and updates the cache', async () => {
    const { loadProductsCache, replaceProductImage, getProductById, saveImageFile } = await import('../../../server/products.js');
    loadProductsCache();
    mkdirSync(join(tmp, 'public/products'), { recursive: true });
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const updated = replaceProductImage('a', fakeJpeg, 'image/jpeg');
    expect(updated.image.startsWith('/products/a-')).toBe(true);
    expect(getProductById('a')?.image).toBe(updated.image);
    // writeFileSync used by saveImageFile actually placed the file
    const filename = updated.image.slice('/products/'.length);
    expect(existsSync(join(tmp, 'public/products', filename))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/server/products.test.ts`
Expected: FAIL module not found.

- [ ] **Step 3: Implement `server/products.ts`**

Create `server/products.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Product {
  id: string;
  name: string;
  image: string;
  price: number;
  currency: string;
  description: string;
  url: string;
  badge?: string;
}

function dataDir(): string { return resolve(process.cwd(), 'public/data'); }
function productsJsonPath(): string { return join(dataDir(), 'products.json'); }
function productsDir(): string { return resolve(process.cwd(), 'public/products'); }

let cache: Product[] | null = null;

export function loadProductsCache(): Product[] {
  const path = productsJsonPath();
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as Product[];
  cache = parsed;
  return cache;
}

function ensureCache(): Product[] {
  if (!cache) loadProductsCache();
  return cache!;
}

export function getAllProducts(): Product[] {
  return ensureCache().map(p => ({ ...p }));
}

export function getProductById(id: string): Product | null {
  const p = ensureCache().find(x => x.id === id);
  return p ? { ...p } : null;
}

function writeAtomic(products: Product[]): void {
  mkdirSync(dataDir(), { recursive: true });
  const finalPath = productsJsonPath();
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(products, null, 2), 'utf-8');
  renameSync(tmpPath, finalPath);
  cache = products;
}

export function updateProduct(id: string, patch: Partial<Omit<Product, 'id'>>): Product {
  const list = ensureCache();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('product not found');
  const next = { ...list[idx], ...patch, id };
  list[idx] = next;
  writeAtomic(list);
  return { ...next };
}

export function createProduct(input: Omit<Product, 'image'> & { image?: string }): Product {
  const list = ensureCache();
  if (!/^[a-z0-9-]+$/.test(input.id)) throw new Error('invalid product id');
  if (list.find(p => p.id === input.id)) throw new Error('product id already exists');
  const product: Product = {
    id: input.id,
    name: input.name,
    image: input.image ?? '/products/placeholder.svg',
    price: input.price,
    currency: input.currency,
    description: input.description,
    url: input.url,
    badge: input.badge,
  };
  list.push(product);
  writeAtomic(list);
  return { ...product };
}

export function deleteProduct(id: string): void {
  const list = ensureCache();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('product not found');
  const removed = list[idx];
  list.splice(idx, 1);
  writeAtomic(list);
  try {
    if (removed.image && removed.image.startsWith('/products/')) {
      const onDisk = join(productsDir(), removed.image.slice('/products/'.length));
      if (existsSync(onDisk) && statSync(onDisk).isFile()) unlinkSync(onDisk);
    }
  } catch (e) {
    console.warn('[products] failed to remove image file', e);
  }
}

const IMG_EXTS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export interface SavedImage { image: string; }

export function saveImageFile(productId: string, buffer: Buffer, mime: string): SavedImage {
  const ext = IMG_EXTS[mime];
  if (!ext) throw new Error('unsupported image mime type');
  mkdirSync(productsDir(), { recursive: true });
  const filename = `${productId}-${randomBytes(6).toString('hex')}${ext}`;
  const finalPath = join(productsDir(), filename);
  writeFileSync(finalPath, buffer);
  return { image: `/products/${filename}` };
}

export function removeOldImageFile(imagePath: string): void {
  try {
    if (!imagePath || !imagePath.startsWith('/products/')) return;
    const onDisk = join(productsDir(), imagePath.slice('/products/'.length));
    if (existsSync(onDisk) && statSync(onDisk).isFile()) unlinkSync(onDisk);
  } catch (e) {
    console.warn('[products] failed to remove old image file', e);
  }
}

export function replaceProductImage(productId: string, buffer: Buffer, mime: string): Product {
  const product = getProductById(productId);
  if (!product) throw new Error('product not found');
  const { image } = saveImageFile(productId, buffer, mime);
  const oldImage = product.image;
  const updated = updateProduct(productId, { image });
  if (oldImage && oldImage !== image) removeOldImageFile(oldImage);
  return updated;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run tests/unit/server/products.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/products.ts tests/unit/server/products.test.ts
git commit -m "feat(products): atomic products.json writer + image upload + cache"
```

---

## Task 7: `server/auth.ts` — DB-backed sessions

**Files:**
- Rewrite: `server/auth.ts`
- Create: `tests/unit/server/auth-token.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/server/auth-token.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

function freshDbPath(): string {
  return join(tmpdir(), `auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

async function freshDb() {
  process.env.STATS_DB_PATH = freshDbPath();
  const db = await import('../../../server/db.js');
  await db.initDb();
  return db;
}

function cleanup() {
  if (existsSync(process.env.STATS_DB_PATH!)) unlinkSync(process.env.STATS_DB_PATH!);
}

describe('auth tokens', () => {
  it('issueSession returns a 64-hex token whose sha256 row exists in auth_tokens', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { issueSession, verifySessionFromRequest } = await import('../../../server/auth.js');
    const u = createUser({ username: 'm', password: 'pw', role: 'merchant' });
    const t = issueSession(u.id);
    expect(typeof t.token).toBe('string');
    expect(t.token.length).toBe(64);
    const tokenHash = createHash('sha256').update(t.token).digest('hex');
    const rows = db.queryAll<{ token_hash: string }>(
      `SELECT token_hash FROM auth_tokens WHERE token_hash = ?`,
      [tokenHash]
    );
    expect(rows.length).toBe(1);

    const req = { headers: { cookie: `statics_token=${t.token}; statics_token_expires=${t.expiresAt}` } } as any;
    const verified = verifySessionFromRequest(req);
    expect(verified?.id).toBe(u.id);

    db.flushNow();
    cleanup();
  });

  it('verifySessionFromRequest returns null when cookies are missing', async () => {
    await freshDb();
    const { verifySessionFromRequest } = await import('../../../server/auth.js');
    expect(verifySessionFromRequest({ headers: {} } as any)).toBeNull();
  });

  it('verifySessionFromRequest returns null when the cookie-side expires_at is past', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { issueSession, verifySessionFromRequest } = await import('../../../server/auth.js');
    const u = createUser({ username: 'm2', password: 'pw', role: 'merchant' });
    const t = issueSession(u.id);
    const req = { headers: { cookie: `statics_token=${t.token}; statics_token_expires=${Date.now() - 1000}` } } as any;
    expect(verifySessionFromRequest(req)).toBeNull();

    db.flushNow();
    cleanup();
  });

  it('verifySessionFromRequest returns null for a disabled user', async () => {
    const db = await freshDb();
    const { createUser, setUserDisabled } = await import('../../../server/users.js');
    const { issueSession, verifySessionFromRequest } = await import('../../../server/auth.js');
    const u = createUser({ username: 'm3', password: 'pw', role: 'merchant' });
    const t = issueSession(u.id);
    setUserDisabled(u.id, true);
    const req = { headers: { cookie: `statics_token=${t.token}; statics_token_expires=${t.expiresAt}` } } as any;
    expect(verifySessionFromRequest(req)).toBeNull();

    db.flushNow();
    cleanup();
  });

  it('clearSessionForUser removes all tokens so the existing cookie stops working', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { issueSession, clearSessionForUser, verifySessionFromRequest } = await import('../../../server/auth.js');
    const u = createUser({ username: 'm4', password: 'pw', role: 'merchant' });
    const t = issueSession(u.id);
    clearSessionForUser(u.id);
    const req = { headers: { cookie: `statics_token=${t.token}; statics_token_expires=${t.expiresAt}` } } as any;
    expect(verifySessionFromRequest(req)).toBeNull();

    db.flushNow();
    cleanup();
  });

  it('clearSessionForCurrentToken removes only that token, leaves siblings alone', async () => {
    const db = await freshDb();
    const { createUser } = await import('../../../server/users.js');
    const { issueSession, clearSessionForCurrentToken, verifySessionFromRequest } = await import('../../../server/auth.js');
    const u = createUser({ username: 'm5', password: 'pw', role: 'merchant' });
    const t1 = issueSession(u.id);
    const t2 = issueSession(u.id);
    const req = { headers: { cookie: `statics_token=${t1.token}; statics_token_expires=${t1.expiresAt}` } } as any;
    clearSessionForCurrentToken(req);
    const req2 = { headers: { cookie: `statics_token=${t2.token}; statics_token_expires=${t2.expiresAt}` } } as any;
    expect(verifySessionFromRequest(req2)?.id).toBe(u.id);

    db.flushNow();
    cleanup();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/server/auth-token.test.ts`
Expected: FAIL `issueSession is not a function` (legacy `auth.ts` does not export it).

- [ ] **Step 3: Rewrite `server/auth.ts`**

Replace the entire file `server/auth.ts` with:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { runStmt, queryAll } from './db.js';
import { getUserById, type UserRow } from './users.js';

export const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

export interface AuthedUser {
  id: number;
  username: string;
  role: 'admin' | 'merchant';
  mustChangePassword: number;
  expiresAt: number | null;
}

export interface IssuedToken {
  token: string;
  expiresAt: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueSession(userId: number): IssuedToken {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  runStmt(
    `INSERT INTO auth_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    [hashToken(token), userId, expiresAt, Date.now()]
  );
  return { token, expiresAt };
}

function extract(req: { headers?: { cookie?: string } }): { token: string; expiresAt: number } | null {
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  let token: string | null = null;
  let expiresAt = 0;
  for (const c of cookies) {
    const eq = c.indexOf('=');
    if (eq === -1) continue;
    const k = c.slice(0, eq);
    const v = c.slice(eq + 1);
    if (k === 'statics_token' && v) token = decodeURIComponent(v);
    if (k === 'statics_token_expires' && v) expiresAt = parseInt(v, 10) || 0;
  }
  if (!token) return null;
  return { token, expiresAt };
}

export function verifySessionFromRequest(req: { headers?: { cookie?: string } }): AuthedUser | null {
  const t = extract(req);
  if (!t) return null;
  if (Date.now() > t.expiresAt) return null;
  const rows = queryAll<{ user_id: number; expires_at: number }>(
    `SELECT user_id, expires_at FROM auth_tokens WHERE token_hash = ?`,
    [hashToken(t.token)]
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() > row.expires_at) return null;
  const u: UserRow | null = getUserById(row.user_id);
  if (!u) return null;
  if (u.disabled) return null;
  if (u.expiresAt != null && Date.now() > u.expiresAt) return null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
    expiresAt: u.expiresAt,
  };
}

export function clearSessionForCurrentToken(req: { headers?: { cookie?: string } }): void {
  const t = extract(req);
  if (!t) return;
  runStmt(`DELETE FROM auth_tokens WHERE token_hash = ?`, [hashToken(t.token)]);
}

export function clearSessionForUser(userId: number): void {
  runStmt(`DELETE FROM auth_tokens WHERE user_id = ?`, [userId]);
}

export const COOKIE_NAME = 'statics_token';
export const COOKIE_EXPIRES = 'statics_token_expires';

export function setAuthCookies(res: { cookie: (n: string, v: string, opts: object) => void }, issued: IssuedToken): void {
  const opts = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: issued.expiresAt - Date.now(),
    path: '/',
  };
  res.cookie(COOKIE_NAME, issued.token, opts);
  res.cookie(COOKIE_EXPIRES, String(issued.expiresAt), opts);
}

export function clearAuthCookies(res: { clearCookie: (n: string, opts: object) => void }): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.clearCookie(COOKIE_EXPIRES, { path: '/' });
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run tests/unit/server/auth-token.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/auth.ts tests/unit/server/auth-token.test.ts
git commit -m "feat(auth): DB-backed session tokens, replaces legacy STATICS_PASSWORD"
```

---

## Task 8: `server/index.ts` — mount auth + admin/products routes + bootstrap

**Files:**
- Rewrite: `server/index.ts`

- [ ] **Step 1: Write integration test for login → me → logout**

Create `tests/unit/server/routes-auth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function buildAppFixture() {
  const base = process.env.STATS_DB_TMPDIR!;
  process.env.STATS_DB_PATH = join(base, 'stats.db');
  process.env.PRODUCTS_JSON_PATH = join(base, 'public/data/products.json');
  mkdirSync(resolve(process.env.PRODUCTS_JSON_PATH, '..'), { recursive: true });
  writeFileSync(process.env.PRODUCTS_JSON_PATH, JSON.stringify([
    { id: 'p-a', name: 'A', image: '', price: 1, currency: 'CNY', description: '', url: '' },
    { id: 'p-b', name: 'B', image: '', price: 1, currency: 'CNY', description: '', url: '' },
  ]));

  const db = await import('../../../server/db.js');
  await db.initDb();

  const users = await import('../../../server/users.js');
  users.seedDefaultAdminIfEmpty();
  const merchant = users.createUser({ username: 'mike', password: 'pw1234', role: 'merchant', mustChangePassword: true });

  const products = await import('../../../server/products.js');
  products.loadProductsCache();

  const auth = await import('../../../server/auth.js');
  const assignments = await import('../../../server/assignments.js');
  assignments.reconcileAssignments(merchant.id, ['p-a']);

  // Use the exported Express app from server/index.js
  const index = await import('../../../server/index.js');
  return { app: index.app, db, auth, users, products, assignments };
}

describe('auth route integration', () => {
  let tmpdir_: string;
  let requestMod: typeof import('supertest');
  let request: typeof import('supertest');

  beforeEach(async () => {
    tmpdir_ = mkdtempSync(join(tmpdir(), 'routes-test-'));
    process.env.STATS_DB_TMPDIR = tmpdir_;
    // Reset modules so server modules see the new STATS_DB_PATH env
    for (const path of Object.keys(require.cache)) {
      if (path.includes('/server/')) delete require.cache[path];
    }
    requestMod = await import('supertest');
    request = requestMod.default ?? requestMod;
  });

  afterEach(() => {
    if (tmpdir_ && existsSync(tmpdir_)) rmSync(tmpdir_, { recursive: true, force: true });
    delete process.env.STATS_DB_TMPDIR;
    for (const path of Object.keys(require.cache)) {
      if (path.includes('/server/')) delete require.cache[path];
    }
  });

  it('login → me → logout flow for the root admin', async () => {
    const { app } = await buildAppFixture();
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ username: 'root', password: 'fansea0117' });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe('admin');
    expect(login.body.mustChangePassword).toBe(false);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('root');

    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);

    const meAgain = await agent.get('/api/auth/me');
    expect(meAgain.status).toBe(401);
  });

  it('merchant login carries mustChangePassword=true', async () => {
    const { app } = await buildAppFixture();
    const r = await request(app).post('/api/auth/login').send({ username: 'mike', password: 'pw1234' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('merchant');
    expect(r.body.mustChangePassword).toBe(true);
  });

  it('wrong password → 401', async () => {
    const { app } = await buildAppFixture();
    const r = await request(app).post('/api/auth/login').send({ username: 'root', password: 'wrong' });
    expect(r.status).toBe(401);
  });

  it('disabled user cannot log in', async () => {
    const { app, users } = await buildAppFixture();
    const u = users.createUser({ username: 'doomed', password: 'pw', role: 'merchant' });
    users.setUserDisabled(u.id, true);
    const r = await request(app).post('/api/auth/login').send({ username: 'doomed', password: 'pw' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('account disabled');
  });

  it('GET /api/products returns only assigned products for merchants', async () => {
    const { app } = await buildAppFixture();
    const login = await request(app).post('/api/auth/login').send({ username: 'mike', password: 'pw1234' });
    expect(login.status).toBe(200);
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const list = await request(app).get('/api/products').set('Cookie', cookies);
    expect(list.status).toBe(200);
    const ids = list.body.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(['p-a']);
  });

  it('merchant cannot PUT a product not assigned to them', async () => {
    const { app } = await buildAppFixture();
    const login = await request(app).post('/api/auth/login').send({ username: 'mike', password: 'pw1234' });
    const cookies = login.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const r = await request(app).put('/api/products/p-b').set('Cookie', cookies).send({ name: 'nope' });
    expect(r.status).toBe(403);
  });
});
```

- [ ] **Step 2: Add a small `requireAuth` shim re-export and the export of `app`**

If `server/index.ts` does not yet export `app`, refactor it so the express `app` is created at module load and both `start()` and tests can drive it. The full rewrite is in the next step.

- [ ] **Step 3: Run the test, expect FAIL**

Run: `npx vitest run tests/unit/server/routes-auth.test.ts`
Expected: FAIL (the test is structured around the app export we'll add next).

- [ ] **Step 4: Replace `server/index.ts` with the full wiring**

Replace the whole file `server/index.ts` with:

```ts
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { initDb, querySummary, trackEvent, touchSession, flushNow, queryAll, dayRange } from './db.js';
import { loadProductsCache, getAllProducts, getProductById, updateProduct, createProduct, deleteProduct, replaceProductImage } from './products.js';
import {
  verifySessionFromRequest, clearAuthCookies, clearSessionForCurrentToken, setAuthCookies,
  clearSessionForUser, issueSession, type AuthedUser,
} from './auth.js';
import {
  getUserByUsername, getUserById, listUsers, createUser, updateUser, deleteUser, setUserDisabled,
  setUserPassword, setUserMustChangePassword, setUserExpiresAt, countAdmins, seedDefaultAdminIfEmpty,
  checkUserPassword,
} from './users.js';
import { reconcileAssignments, revokeAllForProduct, hasActiveAssignment, getActiveAssignmentsForUser } from './assignments.js';

const PORT = Number(process.env.PORT ?? 3000);
const IP_HASH_SALT = process.env.IP_HASH_SALT ?? randomBytes(16).toString('hex');

// Per spec: STATICS_PASSWORD env var is no longer read. Log the legacy hint once
// so operators running a stale .env / .bashrc know to remove it.
if (process.env.STATICS_PASSWORD) {
  console.warn('[pingdou-server] STATICS_PASSWORD env var is ignored (legacy). Set the root password via /api/admin/users after login.');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('unsupported mime'), ok);
  },
});

export const app = express();

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

app.use((req, _res, next) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  (req as any).clientIp = ip;
  next();
});

interface AuthedRequest extends express.Request { user?: AuthedUser; }

export function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const u = verifySessionFromRequest(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  req.user = u;
  next();
}

function requireAdmin(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  next();
}

function requireProductAccess(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role === 'admin') return next();
  const productId = req.params.id;
  if (!hasActiveAssignment(req.user.id, productId)) return res.status(403).json({ error: 'not assigned' });
  next();
}

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, staticsConfigured: true });
});

// Public tracking
app.post('/api/track', (req, res) => {
  const { kind, ref, sid } = req.body ?? {};
  if (kind !== 'page-view' && kind !== 'product-click' && kind !== 'image-export') {
    return res.status(400).json({ error: 'invalid kind' });
  }
  try {
    trackEvent({
      kind,
      ref: typeof ref === 'string' ? ref.slice(0, 200) : undefined,
      ipHash: (req as any).clientIp ?? 'unknown',
      sid: typeof sid === 'string' ? sid.slice(0, 64) : undefined,
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[track]', e);
    return res.status(500).json({ error: 'track failed' });
  }
});

app.post('/api/session/touch', (req, res) => {
  const { sid } = req.body ?? {};
  if (typeof sid !== 'string' || sid.length === 0) return res.status(400).json({ error: 'sid required' });
  try {
    const { day } = touchSession({ sid: sid.slice(0, 64), ipHash: (req as any).clientIp ?? 'unknown' });
    return res.json({ ok: true, day });
  } catch (e) {
    return res.status(500).json({ error: 'session touch failed' });
  }
});

// --- Auth ---
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const u = getUserByUsername(username);
  if (!u) return res.status(401).json({ error: 'invalid credentials' });
  if (u.disabled) return res.status(401).json({ error: 'account disabled' });
  if (u.expiresAt != null && Date.now() > u.expiresAt) return res.status(401).json({ error: 'account expired' });
  if (!checkUserPassword(u.id, password)) return res.status(401).json({ error: 'invalid credentials' });
  const issued = issueSession(u.id);
  setAuthCookies(res, issued);
  res.json({
    ok: true,
    role: u.role,
    username: u.username,
    mustChangePassword: !!u.mustChangePassword,
    expiresAt: u.expiresAt,
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionForCurrentToken(req);
  clearAuthCookies(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  res.json({ id: u.id, username: u.username, role: u.role, mustChangePassword: !!u.mustChangePassword, expiresAt: u.expiresAt });
});

app.post('/api/auth/change-password', requireAuth, (req: AuthedRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 4) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  const u = getUserById(req.user!.id)!;
  if (!checkUserPassword(u.id, currentPassword)) return res.status(401).json({ error: 'current password wrong' });
  setUserPassword(u.id, newPassword);
  setUserDisabled(u.id, false);
  setUserMustChangePassword(u.id, false);
  clearSessionForUser(u.id);
  const issued = issueSession(u.id);
  setAuthCookies(res, issued);
  res.json({ ok: true });
});

// --- Stats summary (role-aware) ---
function buildMerchantSummary(userId: number, days: number) {
  const now = Date.now();
  const fromTs = now - days * 24 * 60 * 60 * 1000;
  const clickTotalRow = queryAll<{ total: number }>(
    `SELECT COUNT(*) AS total FROM events e
       JOIN product_assignments pa ON pa.product_id = e.ref
       WHERE e.kind = 'product-click'
         AND pa.user_id = ?
         AND e.created_at >= pa.assigned_at
         AND (pa.revoked_at IS NULL OR e.created_at < pa.revoked_at)
         AND e.created_at >= ?`,
    [userId, fromTs]
  );
  const pvTotalRow = queryAll<{ total: number }>(
    `SELECT COUNT(*) AS total FROM events WHERE kind = 'page-view' AND created_at >= ?`,
    [fromTs]
  );
  const productCount = getActiveAssignmentsForUser(userId).length;
  const perDayRows = queryAll<{ day: string; total: number }>(
    `SELECT e.day, COUNT(*) AS total FROM events e
       JOIN product_assignments pa ON pa.product_id = e.ref
       WHERE e.kind = 'product-click'
         AND pa.user_id = ?
         AND e.created_at >= pa.assigned_at
         AND (pa.revoked_at IS NULL OR e.created_at < pa.revoked_at)
         AND e.created_at >= ?
       GROUP BY e.day`,
    [userId, fromTs]
  );
  const perDayMap = new Map(perDayRows.map(r => [r.day, r.total]));
  const perDay = dayRange(fromTs, now).map(day => ({ day, myClicks: perDayMap.get(day) ?? 0 }));
  const productBreakdown = queryAll<{ ref: string; total: number }>(
    `SELECT e.ref, COUNT(*) AS total FROM events e
       JOIN product_assignments pa ON pa.product_id = e.ref
       WHERE e.kind = 'product-click'
         AND pa.user_id = ?
         AND e.created_at >= pa.assigned_at
         AND (pa.revoked_at IS NULL OR e.created_at < pa.revoked_at)
         AND e.created_at >= ?
       GROUP BY e.ref
       ORDER BY total DESC`,
    [userId, fromTs]
  );
  return {
    totals: {
      pageView: pvTotalRow[0]?.total ?? 0,
      myClicks: clickTotalRow[0]?.total ?? 0,
      productCount,
    },
    perDay,
    productBreakdown: productBreakdown.map(r => ({ productId: r.ref, total: r.total })),
  };
}

app.get('/api/statics/summary', requireAuth, (req: AuthedRequest, res) => {
  const days = Math.max(1, Math.min(90, Number(req.query.days ?? 7)));
  try {
    if (req.user!.role === 'admin') {
      const summary = querySummary(days);
      return res.json({
        totals: summary.totals,
        perDay: summary.perDay,
        productClicks: summary.productClicks,
      });
    }
    return res.json(buildMerchantSummary(req.user!.id, days));
  } catch (e) {
    console.error('[statics/summary]', e);
    return res.status(500).json({ error: 'query failed' });
  }
});

// --- Products list + edit ---
app.get('/api/products', requireAuth, (req: AuthedRequest, res) => {
  const all = getAllProducts();
  if (req.user!.role === 'admin') return res.json(all);
  const assignedIds = new Set(getActiveAssignmentsForUser(req.user!.id).map(a => a.productId));
  res.json(all.filter(p => assignedIds.has(p.id)));
});

app.put('/api/products/:id', requireAuth, requireProductAccess, (req: AuthedRequest, res) => {
  const { name, description, price, url, badge } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (typeof name === 'string') patch.name = name;
  if (typeof description === 'string') patch.description = description;
  if (typeof price === 'number') patch.price = price;
  if (typeof url === 'string') patch.url = url;
  if (badge === null || typeof badge === 'string') patch.badge = badge ?? undefined;
  try {
    return res.json(updateProduct(req.params.id, patch));
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'update failed' });
  }
});

app.post('/api/products/:id/image', requireAuth, requireProductAccess, upload.single('file'), (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    return res.json(replaceProductImage(req.params.id, req.file.buffer, req.file.mimetype));
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'upload failed' });
  }
});

app.post('/api/products', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  try {
    return res.json(createProduct(req.body ?? {}));
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'create failed' });
  }
});

app.delete('/api/products/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  try {
    deleteProduct(req.params.id);
    revokeAllForProduct(req.params.id);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(404).json({ error: e.message ?? 'delete failed' });
  }
});

// --- Admin: user management ---
app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const list = listUsers().map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    disabled: !!u.disabled,
    mustChangePassword: !!u.mustChangePassword,
    expiresAt: u.expiresAt,
    createdAt: u.createdAt,
    products: getActiveAssignmentsForUser(u.id).map(a => a.productId),
  }));
  res.json(list);
});

app.post('/api/admin/users', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { username, password, role, productIds = [], expiresAt = null, mustChangePassword = false } = req.body ?? {};
  if (typeof username !== 'string') return res.status(400).json({ error: 'username required' });
  if (typeof password !== 'string' || password.length < 4) return res.status(400).json({ error: 'password too short' });
  if (role !== 'admin' && role !== 'merchant') return res.status(400).json({ error: 'invalid role' });
  const validProductIds = new Set(getAllProducts().map(p => p.id));
  for (const pid of productIds) {
    if (!validProductIds.has(pid)) return res.status(400).json({ error: `unknown product: ${pid}` });
  }
  if (Array.isArray(productIds) && productIds.length > 0 && role !== 'merchant') {
    return res.status(400).json({ error: 'productIds only valid for merchants' });
  }
  try {
    const u = createUser({ username, password, role, expiresAt: expiresAt ?? null, mustChangePassword: !!mustChangePassword });
    if (role === 'merchant' && Array.isArray(productIds) && productIds.length > 0) {
      reconcileAssignments(u.id, productIds);
    }
    return res.json({ id: u.id, username: u.username, role: u.role });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'create failed' });
  }
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const { password, disabled, expiresAt, mustChangePassword, productIds } = req.body ?? {};
  try {
    const target = getUserById(id);
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (target.role === 'admin' && countAdmins() === 1 && disabled === true) {
      return res.status(409).json({ error: 'cannot disable the last admin' });
    }
    if (typeof password === 'string') setUserPassword(id, password);
    if (typeof disabled === 'boolean') setUserDisabled(id, disabled);
    if (typeof mustChangePassword === 'boolean') setUserMustChangePassword(id, mustChangePassword);
    if (expiresAt === null || typeof expiresAt === 'number') setUserExpiresAt(id, expiresAt);
    if (Array.isArray(productIds)) {
      const validProductIds = new Set(getAllProducts().map(p => p.id));
      for (const pid of productIds) {
        if (!validProductIds.has(pid)) return res.status(400).json({ error: `unknown product: ${pid}` });
      }
      reconcileAssignments(id, productIds);
    }
    if (typeof password === 'string' || disabled === true) clearSessionForUser(id);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'patch failed' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    deleteUser(id);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(409).json({ error: e.message ?? 'delete failed' });
  }
});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { newPassword } = req.body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < 4) return res.status(400).json({ error: 'password too short' });
  try {
    setUserPassword(id, newPassword);
    clearSessionForUser(id);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'reset failed' });
  }
});

app.get('/api/statics/status', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

// --- Static frontend ---
const distDir = resolve(process.cwd(), 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(resolve(distDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('pingdou server is running. Build the frontend (npm run build) to serve static files.');
  });
}

async function findFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 20; p++) {
    const ok = await new Promise<boolean>(resolve => {
      const tester = createServer()
        .once('error', () => resolve(false))
        .once('listening', () => tester.close(() => resolve(true)))
        .listen(p, '0.0.0.0');
    });
    if (ok) return p;
  }
  return start;
}

export async function start(): Promise<void> {
  await initDb();
  seedDefaultAdminIfEmpty();
  loadProductsCache();

  const requested = PORT;
  const actual = await findFreePort(requested);
  if (actual !== requested) {
    console.warn(`[pingdou-server] Port ${requested} is busy, falling back to ${actual}`);
  }

  app.listen(actual, () => {
    console.log(`[pingdou-server] listening on http://0.0.0.0:${actual}`);
    console.log(`[pingdou-server] App:    http://localhost:${actual}/`);
    console.log(`[pingdou-server] Statics: http://localhost:${actual}/statics`);
  });
}

if (require.main === module) {
  start().catch(err => {
    console.error('[pingdou-server] failed to start:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run tests/unit/server/routes-auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Server-side typecheck**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add server/index.ts tests/unit/server/routes-auth.test.ts
git commit -m "feat(server): multi-account auth + admin/products routes + bootstrap, legacy password removed"
```

---

## Task 9: `src/api/statics.ts` — typed login + fetchSummary + change-password + me

**Files:**
- Rewrite: `src/api/statics.ts`

- [ ] **Step 1: Replace `src/api/statics.ts`**

Replace the entire file with:

```ts
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

export async function fetchSummary(days: number, role: 'admin' | 'merchant'): Promise<AdminSummary | MerchantSummary> {
  const res = await fetch(`${BASE}/statics/summary?days=${days}`, { credentials: 'include' });
  return jsonOrThrow<AdminSummary | MerchantSummary>(res);
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
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: success (any "unknown caller of `login(password)`" complains will be fixed in tasks 10–13 when callers move to the new shape).

- [ ] **Step 3: Commit**

```bash
git add src/api/statics.ts
git commit -m "refactor(api/statics): typed login + me + role-aware summary"
```

---

## Task 10: `src/api/users.ts` — admin user-management client

**Files:**
- Create: `src/api/users.ts`

- [ ] **Step 1: Create the file**

Create `src/api/users.ts`:

```ts
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
```

- [ ] **Step 2: Compile**

Run: `npx tsc --noEmit`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/api/users.ts
git commit -m "feat(api/users): admin user-management client"
```

---

## Task 11: `src/api/products.ts` — products client (admin + merchant)

**Files:**
- Create: `src/api/products.ts`

- [ ] **Step 1: Create the file**

Create `src/api/products.ts`:

```ts
const BASE = '/api';

export interface Product {
  id: string;
  name: string;
  image: string;
  price: number;
  currency: string;
  description: string;
  url: string;
  badge?: string;
}

export interface ProductPatch {
  name?: string;
  description?: string;
  price?: number;
  url?: string;
  badge?: string | null;
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

export async function listProducts(): Promise<Product[]> {
  const res = await fetch(`${BASE}/products`, { credentials: 'include' });
  return jsonOrThrow<Product[]>(res);
}

export async function updateProduct(id: string, patch: ProductPatch): Promise<Product> {
  const res = await fetch(`${BASE}/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    credentials: 'include',
  });
  return jsonOrThrow<Product>(res);
}

export async function uploadProductImage(id: string, file: File): Promise<Product> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${BASE}/products/${id}/image`, {
    method: 'POST',
    body: fd,
    credentials: 'include',
  });
  return jsonOrThrow<Product>(res);
}

export async function adminCreateProduct(product: Omit<Product, 'badge'> & { badge?: string }): Promise<Product> {
  const res = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product),
    credentials: 'include',
  });
  return jsonOrThrow<Product>(res);
}

export async function adminDeleteProduct(id: string): Promise<{ ok: true }> {
  const res = await fetch(`${BASE}/products/${id}`, { method: 'DELETE', credentials: 'include' });
  return jsonOrThrow(res);
}
```

- [ ] **Step 2: Compile**

Run: `npx tsc --noEmit`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/api/products.ts
git commit -m "feat(api/products): list/update/upload/create/delete product client"
```

---

## Task 12: `src/components/ChangePasswordModal.tsx`

**Files:**
- Create: `src/components/ChangePasswordModal.tsx`
- Create: `src/components/ChangePasswordModal.css`
- Create: `src/components/ChangePasswordModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/ChangePasswordModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/statics', () => ({
  changePassword: vi.fn().mockResolvedValue(undefined),
}));

import { ChangePasswordModal } from './ChangePasswordModal';

describe('ChangePasswordModal', () => {
  it('renders both current and new password fields', () => {
    render(<ChangePasswordModal required={false} onSuccess={() => {}} />);
    expect(screen.getByLabelText(/current password/i)).toBeTruthy();
    expect(screen.getByLabelText(/new password/i)).toBeTruthy();
  });

  it('hides the close button when required=true (cannot dismiss)', () => {
    render(<ChangePasswordModal required={true} onSuccess={() => {}} />);
    expect(screen.queryByLabelText(/^close$/i)).toBeNull();
  });

  it('shows the close button when required=false and onClose is provided', () => {
    render(<ChangePasswordModal required={false} onSuccess={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText(/^close$/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/components/ChangePasswordModal.test.tsx`
Expected: FAIL missing module.

- [ ] **Step 3: Implement `ChangePasswordModal`**

Create `src/components/ChangePasswordModal.tsx`:

```tsx
import { useState } from 'react';
import { changePassword } from '@/api/statics';
import './ChangePasswordModal.css';

interface Props {
  required: boolean;
  onClose?: () => void;
  onSuccess: () => void;
}

export function ChangePasswordModal({ required, onClose, onSuccess }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canDismiss = !required && Boolean(onClose);
  const valid = current.length > 0 && next.length >= 4 && next !== current;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      onSuccess();
    } catch (err: any) {
      setError(err?.message ?? 'change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={canDismiss ? onClose : undefined}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        {canDismiss && (
          <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        )}
        <h3>修改密码</h3>
        {required && <p className="modal-hint">首次登录请修改默认密码后再继续。</p>}
        <label>
          当前密码
          <input type="password" value={current} onChange={e => setCurrent(e.target.value)} disabled={busy} autoFocus />
        </label>
        <label>
          新密码（至少 4 位）
          <input type="password" value={next} onChange={e => setNext(e.target.value)} disabled={busy} />
        </label>
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={!valid || busy}>
          {busy ? '保存中...' : '保存'}
        </button>
      </form>
    </div>
  );
}
```

Create `src/components/ChangePasswordModal.css`:

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal-card {
  position: relative;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--space-5);
  width: 360px;
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.modal-card h3 { font-size: var(--text-base); font-weight: 600; }
.modal-card label { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-sm); color: var(--color-text-muted); }
.modal-card input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-surface);
}
.modal-card input:focus { outline: none; border-color: var(--color-accent); }
.modal-card .primary {
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  cursor: pointer;
}
.modal-card .primary:disabled { opacity: 0.55; cursor: not-allowed; }
.modal-close {
  position: absolute;
  top: 8px;
  right: 12px;
  background: transparent;
  border: none;
  font-size: 22px;
  cursor: pointer;
  color: var(--color-text-muted);
}
.modal-hint { color: var(--color-text-muted); font-size: var(--text-sm); }
.modal-error { color: var(--color-error-fg); background: var(--color-error-bg); padding: var(--space-2); border-radius: var(--radius-sm); font-size: var(--text-sm); }
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/components/ChangePasswordModal.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChangePasswordModal.tsx src/components/ChangePasswordModal.css src/components/ChangePasswordModal.test.tsx
git commit -m "feat(ui): ChangePasswordModal (required + voluntary)"
```

---

## Task 13: `src/components/ProductEditModal.tsx` (text + image upload)

**Files:**
- Create: `src/components/ProductEditModal.tsx`
- Create: `src/components/ProductEditModal.css`
- Create: `src/components/ProductEditModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/ProductEditModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/products', () => ({
  updateProduct: vi.fn().mockResolvedValue({}),
  uploadProductImage: vi.fn().mockResolvedValue({}),
}));

import { ProductEditModal } from './ProductEditModal';

describe('ProductEditModal', () => {
  const product = {
    id: 'p-a',
    name: 'A',
    image: '/products/a.jpg',
    price: 1,
    currency: 'CNY',
    description: '',
    url: '',
  };

  it('renders editable text fields prefilled', () => {
    render(<ProductEditModal product={product} onClose={() => {}} onSaved={() => {}} />);
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe('A');
    expect((screen.getByLabelText(/price/i) as HTMLInputElement).value).toBe('1');
  });

  it('shows a file input accepting image/*', () => {
    render(<ProductEditModal product={product} onClose={() => {}} onSaved={() => {}} />);
    const input = screen.getByLabelText(/upload image/i) as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/*');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/components/ProductEditModal.test.tsx`
Expected: FAIL missing module.

- [ ] **Step 3: Implement**

Create `src/components/ProductEditModal.tsx`:

```tsx
import { useState } from 'react';
import { updateProduct, uploadProductImage, type Product } from '@/api/products';
import './ProductEditModal.css';

interface Props {
  product: Product;
  onClose: () => void;
  onSaved: (next: Product) => void;
}

export function ProductEditModal({ product, onClose, onSaved }: Props) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  const [price, setPrice] = useState(String(product.price));
  const [url, setUrl] = useState(product.url);
  const [badge, setBadge] = useState(product.badge ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState(product.image);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const numericPrice = Number(price);
      if (Number.isNaN(numericPrice)) throw new Error('invalid price');
      const updated = await updateProduct(product.id, {
        name,
        description,
        price: numericPrice,
        url,
        badge: badge === '' ? null : badge,
      });
      const fileInput = document.getElementById('product-image-input') as HTMLInputElement | null;
      const file = fileInput?.files?.[0] ?? null;
      let next: Product = updated;
      if (file) next = await uploadProductImage(product.id, file);
      setImagePath(next.image);
      onSaved(next);
    } catch (err: any) {
      setError(err?.message ?? 'save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card product-edit" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        <h3>编辑商品 {product.id}</h3>
        {imagePath && <img src={imagePath} alt="" className="product-edit-thumb" />}
        <label>
          名称
          <input value={name} onChange={e => setName(e.target.value)} disabled={busy} />
        </label>
        <label>
          价格
          <input value={price} onChange={e => setPrice(e.target.value)} disabled={busy} inputMode="decimal" />
        </label>
        <label>
          链接
          <input value={url} onChange={e => setUrl(e.target.value)} disabled={busy} />
        </label>
        <label>
          介绍
          <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={busy} />
        </label>
        <label>
          角标 (可空)
          <input value={badge} onChange={e => setBadge(e.target.value)} disabled={busy} placeholder="如：热销 / 新品" />
        </label>
        <label className="product-edit-upload">
          上传图片 (jpeg / png / webp, ≤ 5 MB)
          <input id="product-image-input" type="file" accept="image/*" disabled={busy} aria-label="upload image" />
        </label>
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? '保存中...' : '保存'}
        </button>
      </form>
    </div>
  );
}
```

Create `src/components/ProductEditModal.css`:

```css
.modal-card.product-edit { width: 460px; }
.modal-card textarea {
  min-height: 60px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--text-sm);
  background: var(--color-surface);
  color: var(--color-text);
  resize: vertical;
}
.product-edit-thumb {
  width: 100%;
  max-height: 160px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  background: var(--color-surface-alt);
}
.product-edit-upload input[type="file"] { font-size: var(--text-sm); }
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/components/ProductEditModal.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ProductEditModal.tsx src/components/ProductEditModal.css src/components/ProductEditModal.test.tsx
git commit -m "feat(ui): ProductEditModal (text fields + image upload)"
```

---

## Task 14: `src/pages/admin/StatsTab.tsx` (extract admin dashboard body from current `StaticsPage`)

**Files:**
- Create: `src/pages/admin/StatsTab.tsx`

- [ ] **Step 1: Create the file**

Create `src/pages/admin/StatsTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchSummary, type AdminSummary } from '@/api/statics';

export function StatsTab() {
  const [days, setDays] = useState<number>(7);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchSummary(days, 'admin')
      .then(s => setSummary(s as AdminSummary))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div className="statics-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h3>统计概览</h3>
        <select value={days} onChange={e => setDays(Number(e.target.value))}>
          <option value={1}>最近 1 天</option>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={90}>最近 90 天</option>
        </select>
      </div>
      {error && <p className="statics-error">加载失败：{error}</p>}
      {loading && <p className="statics-loading">加载中...</p>}
      {summary && (
        <>
          <div className="statics-grid">
            <StatCard label="独立访客 (UV)" value={summary.totals.uv} />
            <StatCard label="浏览量 (PV)" value={summary.totals.pageView} />
            <StatCard label="商品点击" value={summary.totals.productClick} />
            <StatCard label="图片导出" value={summary.totals.imageExport} />
          </div>
          <h3>每日事件总数</h3>
          <DayChart data={summary.perDay} />
          <h3 style={{ marginTop: 'var(--space-4)' }}>商品点击排名</h3>
          {summary.productClicks.length === 0 ? (
            <p className="statics-empty">暂无数据</p>
          ) : (
            <table className="statics-table">
              <thead>
                <tr>
                  <th>商品 ID</th>
                  <th>点击数</th>
                </tr>
              </thead>
              <tbody>
                {summary.productClicks.map(p => (
                  <tr key={p.ref}>
                    <td>{p.ref}</td>
                    <td>{p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function DayChart({ data }: { data: { day: string; total: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.total));
  const W = 800;
  const H = 200;
  const PAD_L = 32;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  if (data.length === 0) return <p className="statics-empty">暂无数据</p>;
  const barW = Math.max(2, (innerW / data.length) * 0.7);
  const gap = innerW / data.length;
  const xLabelStride = data.length > 14 ? Math.ceil(data.length / 7) : data.length > 7 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="day-chart">
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#d9c9b9" strokeWidth="1" />
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#d9c9b9" strokeWidth="1" />
      <text x={4} y={PAD_T + 8} fontSize="10" fill="#968b80">{max}</text>
      <text x={4} y={H - PAD_B} fontSize="10" fill="#968b80">0</text>
      {data.map((d, i) => {
        const h = (d.total / max) * innerH;
        const x = PAD_L + i * gap + (gap - barW) / 2;
        const y = H - PAD_B - h;
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={barW} height={h} fill="#e07856" rx="2" />
            {i % xLabelStride === 0 && (
              <text x={x + barW / 2} y={H - PAD_B + 14} fontSize="9" fill="#968b80" textAnchor="middle">{d.day.slice(5)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 2: Compile**

Run: `npx tsc --noEmit`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/StatsTab.tsx
git commit -m "refactor(admin): extract StatsTab from StaticsPage"
```

---

## Task 15: `src/pages/admin/UsersTab.tsx`

**Files:**
- Create: `src/pages/admin/UsersTab.tsx`
- Create: `src/pages/admin/UsersTab.css`
- Create: `src/pages/admin/UsersTab.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/pages/admin/UsersTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/users', () => ({
  adminListUsers: vi.fn().mockResolvedValue([
    { id: 1, username: 'root', role: 'admin', disabled: false, mustChangePassword: false, expiresAt: null, createdAt: 0, products: [] },
    { id: 2, username: 'mike', role: 'merchant', disabled: false, mustChangePassword: false, expiresAt: null, createdAt: 0, products: ['p-a'] },
  ]),
  adminCreateUser: vi.fn().mockResolvedValue({ id: 3, username: 'new', role: 'merchant' }),
  adminPatchUser: vi.fn().mockResolvedValue({ ok: true }),
  adminDeleteUser: vi.fn().mockResolvedValue({ ok: true }),
  adminResetPassword: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/api/products', () => ({
  listProducts: vi.fn().mockResolvedValue([
    { id: 'p-a', name: 'A', image: '', price: 1, currency: 'CNY', description: '', url: '' },
  ]),
}));

import { UsersTab } from './UsersTab';

describe('UsersTab', () => {
  it('lists users and opens the new-user modal on 新建账号 click', async () => {
    render(<UsersTab />);
    await waitFor(() => screen.getByText('root'));
    fireEvent.click(screen.getByRole('button', { name: /新建账号/i }));
    expect(screen.getByText(/创建新账号/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/pages/admin/UsersTab.test.tsx`
Expected: FAIL missing file.

- [ ] **Step 3: Implement**

Create `src/pages/admin/UsersTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  adminListUsers, adminCreateUser, adminPatchUser, adminDeleteUser, adminResetPassword,
  type AdminUserView,
} from '@/api/users';
import { listProducts, type Product } from '@/api/products';
import './UsersTab.css';

export function UsersTab() {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<AdminUserView | null>(null);
  const [renewing, setRenewing] = useState<AdminUserView | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, p] = await Promise.all([adminListUsers(), listProducts()]);
      setUsers(u);
      setProducts(p);
    } catch (e: any) {
      setError(e.message ?? 'load failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, []);

  const toggleDisabled = async (u: AdminUserView) => {
    try {
      await adminPatchUser(u.id, { disabled: !u.disabled });
      await reload();
    } catch (e: any) {
      alert(e.message ?? 'patch failed');
    }
  };
  const removeUser = async (u: AdminUserView) => {
    if (!confirm(`确定删除 ${u.username}?`)) return;
    try {
      await adminDeleteUser(u.id);
      await reload();
    } catch (e: any) {
      alert(e.message ?? 'delete failed');
    }
  };

  return (
    <div className="statics-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h3>账号管理</h3>
        <button className="primary" onClick={() => setCreating(true)}>新建账号</button>
      </div>
      {loading && <p className="statics-loading">加载中...</p>}
      {error && <p className="statics-error">{error}</p>}
      {!loading && (
        <table className="statics-table users-tab-table">
          <thead>
            <tr>
              <th>账号</th><th>角色</th><th>状态</th><th>商品</th><th>过期时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.username}{u.mustChangePassword ? ' (待改密)' : ''}</td>
                <td>{u.role === 'admin' ? '管理员' : '商家'}</td>
                <td>{u.disabled ? '已禁用' : '正常'}</td>
                <td>{u.products.length === 0 ? '—' : u.products.join(', ')}</td>
                <td>{u.expiresAt ? new Date(u.expiresAt).toLocaleDateString() : '永久'}</td>
                <td className="users-tab-actions">
                  <button onClick={() => setResetting(u)}>重置密码</button>
                  <button onClick={() => setRenewing(u)}>续期</button>
                  <button onClick={() => toggleDisabled(u)}>{u.disabled ? '启用' : '禁用'}</button>
                  <button className="danger" onClick={() => removeUser(u)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && (
        <CreateUserModal products={products} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} />
      )}
      {resetting && (
        <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} onDone={async () => { setResetting(null); await reload(); }} />
      )}
      {renewing && (
        <RenewModal user={renewing} onClose={() => setRenewing(null)} onDone={async () => { setRenewing(null); await reload(); }} />
      )}
    </div>
  );
}

function CreateUserModal({ products, onClose, onCreated }: { products: Product[]; onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'merchant' | 'admin'>('merchant');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [mustChange, setMustChange] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminCreateUser({
        username,
        password,
        role,
        productIds: role === 'merchant' ? productIds : [],
        mustChangePassword: mustChange,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message ?? 'create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        <h3>创建新账号</h3>
        <label>账号<input value={username} onChange={e => setUsername(e.target.value)} disabled={busy} /></label>
        <label>初始密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
        <label>角色
          <select value={role} onChange={e => setRole(e.target.value as 'admin' | 'merchant')} disabled={busy}>
            <option value="merchant">商家</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={mustChange} onChange={e => setMustChange(e.target.checked)} disabled={busy} />
          首次登录需修改密码
        </label>
        {role === 'merchant' && (
          <fieldset className="users-tab-products">
            <legend>分配商品</legend>
            {products.length === 0 && <p className="statics-empty">暂无商品</p>}
            {products.map(p => (
              <label key={p.id} className="users-tab-product-row">
                <input type="checkbox" disabled={busy}
                  checked={productIds.includes(p.id)}
                  onChange={e => setProductIds(ids => e.target.checked ? [...ids, p.id] : ids.filter(x => x !== p.id))}
                />
                {p.name} ({p.id})
              </label>
            ))}
          </fieldset>
        )}
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy || username.length === 0 || password.length < 4}>{busy ? '创建中...' : '创建'}</button>
      </form>
    </div>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: AdminUserView; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminResetPassword(user.id, pw);
      onDone();
    } catch (err: any) {
      setError(err.message ?? 'reset failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        <h3>重置 {user.username} 的密码</h3>
        <label>新密码（≥ 4 位）
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} disabled={busy} />
        </label>
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy || pw.length < 4}>{busy ? '保存中...' : '保存'}</button>
      </form>
    </div>
  );
}

function RenewModal({ user, onClose, onDone }: { user: AdminUserView; onClose: () => void; onDone: () => void }) {
  const today = new Date();
  const defaultExpiry = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()).getTime();
  const initial = user.expiresAt ?? defaultExpiry;
  const [ts, setTs] = useState(new Date(initial).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminPatchUser(user.id, { expiresAt: new Date(ts).getTime() });
      onDone();
    } catch (err: any) {
      setError(err.message ?? 'renew failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        <h3>为 {user.username} 续期</h3>
        <label>到期日<input type="date" value={ts} onChange={e => setTs(e.target.value)} disabled={busy} /></label>
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? '保存中...' : '保存'}</button>
      </form>
    </div>
  );
}
```

Create `src/pages/admin/UsersTab.css`:

```css
.users-tab-actions { display: flex; gap: var(--space-1); flex-wrap: wrap; }
.users-tab-actions button {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: var(--text-xs);
  cursor: pointer;
  color: var(--color-text);
}
.users-tab-actions button:hover { border-color: var(--color-accent); color: var(--color-accent); }
.users-tab-actions button.danger { color: var(--color-error-fg); border-color: var(--color-error-fg); }
.users-tab-table th:nth-child(6), .users-tab-table td:nth-child(6) { white-space: nowrap; }
.users-tab-products { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-2); }
.users-tab-product-row { display: flex; gap: 6px; align-items: center; }
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/pages/admin/UsersTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/UsersTab.tsx src/pages/admin/UsersTab.css src/pages/admin/UsersTab.test.tsx
git commit -m "feat(admin): UsersTab + create/reset/renew modals"
```

---

## Task 16: `src/pages/admin/ProductsTab.tsx`

**Files:**
- Create: `src/pages/admin/ProductsTab.tsx`

- [ ] **Step 1: Implement**

Create `src/pages/admin/ProductsTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { listProducts, adminCreateProduct, adminDeleteProduct, type Product } from '@/api/products';
import { ProductEditModal } from '@/components/ProductEditModal';

export function ProductsTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try { setProducts(await listProducts()); }
    catch (e: any) { setError(e.message ?? 'load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const remove = async (p: Product) => {
    if (!confirm(`确定删除 ${p.id}? 关联历史事件保留但不再对任何商家可见。`)) return;
    try {
      await adminDeleteProduct(p.id);
      await reload();
    } catch (e: any) {
      alert(e.message ?? 'delete failed');
    }
  };

  return (
    <div className="statics-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h3>商品管理</h3>
        <button className="primary" onClick={() => setCreating(true)}>新建商品</button>
      </div>
      {loading && <p className="statics-loading">加载中...</p>}
      {error && <p className="statics-error">{error}</p>}
      {!loading && (
        <table className="statics-table">
          <thead>
            <tr>
              <th>ID</th><th>名称</th><th>价格</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td>{p.price}</td>
                <td>
                  <button onClick={() => setEditing(p)}>编辑</button>
                  <button className="danger" onClick={() => remove(p)} style={{ marginLeft: 4 }}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <ProductEditModal product={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      )}
      {creating && (
        <CreateProductModal onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} />
      )}
    </div>
  );
}

function CreateProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [currency, setCurrency] = useState('CNY');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminCreateProduct({ id, name, image: '', price: Number(price), currency, description, url });
      onCreated();
    } catch (err: any) {
      setError(err.message ?? 'create failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="modal-close" aria-label="close" onClick={onClose}>×</button>
        <h3>新建商品</h3>
        <label>ID (小写字母数字与连字符)<input value={id} onChange={e => setId(e.target.value)} disabled={busy} /></label>
        <label>名称<input value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
        <label>价格<input value={price} onChange={e => setPrice(e.target.value)} disabled={busy} inputMode="decimal" /></label>
        <label>币种<input value={currency} onChange={e => setCurrency(e.target.value)} disabled={busy} /></label>
        <label>链接<input value={url} onChange={e => setUrl(e.target.value)} disabled={busy} /></label>
        <label>介绍<textarea value={description} onChange={e => setDescription(e.target.value)} disabled={busy} /></label>
        {error && <p className="modal-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy || !/^[a-z0-9-]+$/.test(id) || name.length === 0}>{busy ? '创建中...' : '创建'}</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Compile**

Run: `npx tsc --noEmit`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/ProductsTab.tsx
git commit -m "feat(admin): ProductsTab + create-product modal"
```

---

## Task 17: `src/pages/merchant/MerchantDashboard.tsx`

**Files:**
- Create: `src/pages/merchant/MerchantDashboard.tsx`

- [ ] **Step 1: Implement**

Create `src/pages/merchant/MerchantDashboard.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchSummary, type MerchantSummary } from '@/api/statics';
import { listProducts, type Product } from '@/api/products';
import { ProductEditModal } from '@/components/ProductEditModal';

export function MerchantDashboard() {
  const [summary, setSummary] = useState<MerchantSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [days, setDays] = useState<number>(7);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const reload = async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([
        fetchSummary(d, 'merchant') as Promise<MerchantSummary>,
        listProducts(),
      ]);
      setSummary(s);
      setProducts(p);
    } catch (e: any) {
      setError(e.message ?? 'load failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(days); }, [days]);

  return (
    <>
      <div className="statics-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
          <h3>我的数据</h3>
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={1}>最近 1 天</option>
            <option value={7}>最近 7 天</option>
            <option value={30}>最近 30 天</option>
            <option value={90}>最近 90 天</option>
          </select>
        </div>
        {error && <p className="statics-error">加载失败：{error}</p>}
        {loading && <p className="statics-loading">加载中...</p>}
        {summary && (
          <>
            <div className="statics-grid">
              <StatCard label="我的商品点击" value={summary.totals.myClicks} />
              <StatCard label="站点总 PV" value={summary.totals.pageView} />
              <StatCard label="我的商品数" value={summary.totals.productCount} />
            </div>
            <h3>每日点击</h3>
            <DayChartMy data={summary.perDay} />
          </>
        )}
      </div>

      <div className="statics-section">
        <h3>我的商品</h3>
        {products.length === 0 ? (
          <p className="statics-empty">暂未分配商品，请联系管理员</p>
        ) : (
          <table className="statics-table">
            <thead>
              <tr>
                <th>商品</th>
                {summary && <th>点击数</th>}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const stat = summary?.productBreakdown.find(b => b.productId === p.id);
                return (
                  <tr key={p.id}>
                    <td>{p.name} ({p.id})</td>
                    {summary && <td>{stat?.total ?? 0}</td>}
                    <td><button onClick={() => setEditing(p)}>编辑</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <ProductEditModal
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(days); }}
        />
      )}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function DayChartMy({ data }: { data: { day: string; myClicks: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.myClicks));
  const W = 800;
  const H = 200;
  const PAD_L = 32;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  if (data.length === 0) return <p className="statics-empty">暂无数据</p>;
  const barW = Math.max(2, (innerW / data.length) * 0.7);
  const gap = innerW / data.length;
  const xLabelStride = data.length > 14 ? Math.ceil(data.length / 7) : data.length > 7 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="day-chart">
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#d9c9b9" strokeWidth="1" />
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#d9c9b9" strokeWidth="1" />
      <text x={4} y={PAD_T + 8} fontSize="10" fill="#968b80">{max}</text>
      <text x={4} y={H - PAD_B} fontSize="10" fill="#968b80">0</text>
      {data.map((d, i) => {
        const h = (d.myClicks / max) * innerH;
        const x = PAD_L + i * gap + (gap - barW) / 2;
        const y = H - PAD_B - h;
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={barW} height={h} fill="#e07856" rx="2" />
            {i % xLabelStride === 0 && (
              <text x={x + barW / 2} y={H - PAD_B + 14} fontSize="9" fill="#968b80" textAnchor="middle">{d.day.slice(5)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 2: Compile**

Run: `npx tsc --noEmit`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pages/merchant/MerchantDashboard.tsx
git commit -m "feat(merchant): MerchantDashboard with cards, chart, per-product table"
```

---

## Task 18: `src/pages/admin/AdminDashboard.tsx`

**Files:**
- Create: `src/pages/admin/AdminDashboard.tsx`

- [ ] **Step 1: Implement**

Create `src/pages/admin/AdminDashboard.tsx`:

```tsx
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
```

- [ ] **Step 2: Compile**

Run: `npx tsc --noEmit`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/AdminDashboard.tsx
git commit -m "feat(admin): AdminDashboard with Stats/Users/Products tabs"
```

---

## Task 19: Rewrite `src/pages/StaticsPage.tsx` orchestrator

**Files:**
- Rewrite: `src/pages/StaticsPage.tsx`
- Modify: `src/pages/StaticsPage.css`
- Create: `src/pages/StaticsPage.test.tsx`

- [ ] **Step 1: Write failing tests for the orchestrator**

Create `src/pages/StaticsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const meState: { value: any } = { value: null as any };
vi.mock('@/api/statics', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ ok: true, staticsConfigured: true }),
  fetchMe: vi.fn().mockImplementation(() => Promise.resolve(meState.value)),
  loginWithUsername: vi.fn().mockResolvedValue({ ok: true, role: 'admin', username: 'root', mustChangePassword: false, expiresAt: null, id: 1 }),
  logout: vi.fn().mockResolvedValue(undefined),
  fetchSummary: vi.fn().mockResolvedValue({ totals: {}, perDay: [], productClicks: [] }),
  trackEvent: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock('./admin/AdminDashboard', () => ({ AdminDashboard: () => <div data-testid="admin-dashboard" /> }));
vi.mock('./merchant/MerchantDashboard', () => ({ MerchantDashboard: () => <div data-testid="merchant-dashboard" /> }));

import { StaticsPage } from './StaticsPage';

describe('StaticsPage', () => {
  beforeEach(() => { meState.value = null; });

  it('renders login form when /me 401s', async () => {
    meState.value = null;
    vi.mocked((await import('@/api/statics')).fetchMe).mockRejectedValueOnce(new Error('401'));
    render(<StaticsPage />);
    await waitFor(() => screen.getByText(/登录/));
    expect(screen.getByText(/登录/)).toBeTruthy();
  });

  it('renders admin dashboard when me.role=admin', async () => {
    meState.value = { id: 1, username: 'root', role: 'admin', mustChangePassword: false, expiresAt: null };
    render(<StaticsPage />);
    await waitFor(() => screen.getByTestId('admin-dashboard'));
    expect(screen.getByTestId('admin-dashboard')).toBeTruthy();
  });

  it('renders merchant dashboard when me.role=merchant', async () => {
    meState.value = { id: 2, username: 'mike', role: 'merchant', mustChangePassword: false, expiresAt: null };
    render(<StaticsPage />);
    await waitFor(() => screen.getByTestId('merchant-dashboard'));
    expect(screen.getByTestId('merchant-dashboard')).toBeTruthy();
  });

  it('blocks rendering dashboard behind a forced password-change modal when mustChangePassword=true', async () => {
    meState.value = { id: 2, username: 'mike', role: 'merchant', mustChangePassword: true, expiresAt: null };
    render(<StaticsPage />);
    await waitFor(() => screen.getByText(/首次登录请修改默认密码后再继续/));
    expect(screen.getByText(/首次登录请修改默认密码/)).toBeTruthy();
    expect(screen.queryByTestId('merchant-dashboard')).toBeNull();
  });
});
```

Note: the third test relies on the modal blocking render. Importing the actual `ChangePasswordModal` is fine because it self-mounts the modal as a sibling. The test plan ensures the dashboard isn't reachable while required modal is up.

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/pages/StaticsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite `src/pages/StaticsPage.tsx`**

Replace the entire file `src/pages/StaticsPage.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import {
  fetchMe, loginWithUsername, logout, type Me,
} from '@/api/statics';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { AdminDashboard } from './admin/AdminDashboard';
import { MerchantDashboard } from './merchant/MerchantDashboard';
import './StaticsPage.css';

type Status = 'loading' | 'login' | 'authed';

export function StaticsPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const m = await fetchMe();
        setMe(m);
        setStatus('authed');
      } catch {
        setStatus('login');
      }
    })();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoginError(null);
    setLoggingIn(true);
    try {
      const m = await loginWithUsername(username, password);
      setMe(m);
      setStatus('authed');
      setUsername('');
      setPassword('');
    } catch (err: any) {
      setLoginError(err?.message ?? '登录失败');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setMe(null);
    setStatus('login');
  };

  const refreshMe = async () => {
    try { setMe(await fetchMe()); } catch { setStatus('login'); }
  };

  if (status === 'loading') {
    return <div className="statics-page"><div className="statics-card">加载中...</div></div>;
  }

  if (status === 'login') {
    return (
      <div className="statics-page">
        <form className="statics-card" onSubmit={handleLogin}>
          <h2>拼豆图统计</h2>
          <p>请输入账号密码</p>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="账号"
            autoFocus
            disabled={loggingIn}
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="密码"
            disabled={loggingIn}
          />
          {loginError && <p className="statics-error">{loginError}</p>}
          <button type="submit" className="primary" disabled={loggingIn || !username || !password}>
            {loggingIn ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    );
  }

  // authed
  return (
    <div className="statics-page">
      <div className="statics-header">
        <h1>拼豆图统计</h1>
        <div className="statics-controls">
          <span className="statics-greeting">{me?.username}</span>
          <button className="statics-secondary" onClick={() => {
            setForceModalOpen(true);
          }}>修改密码</button>
          <button className="statics-secondary" onClick={handleLogout}>退出</button>
        </div>
      </div>
      {me?.role === 'admin' ? <AdminDashboard /> : <MerchantDashboard />}
      {me?.mustChangePassword && (
        <ChangePasswordModal
          required
          onSuccess={async () => { await refreshMe(); }}
        />
      )}
      {forceModalOpen && (
        <ChangePasswordModal
          required={false}
          onClose={() => setForceModalOpen(false)}
          onSuccess={async () => { setForceModalOpen(false); await refreshMe(); }}
        />
      )}
    </div>
  );
}
```

Add the missing state declaration at the top of the component (this was accidentally omitted above). Replace the body of `StaticsPage` so the component declaration begins with:

```tsx
export function StaticsPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [forceModalOpen, setForceModalOpen] = useState(false);
  // ...rest of body unchanged from above
```

- [ ] **Step 4: Add a couple of CSS rules to support tabs + greeting**

Append to `src/pages/StaticsPage.css`:

```css
.statics-tabs {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
.statics-tabs button {
  background: transparent;
  border: none;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.statics-tabs button.active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}
.statics-greeting {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-right: var(--space-2);
}
.statics-card input[type="text"],
.statics-card input[type="password"] {
  display: block;
  width: 100%;
  margin-bottom: var(--space-3);
}
.statics-card .primary {
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  cursor: pointer;
}
.statics-card .primary:disabled { opacity: 0.55; cursor: not-allowed; }
```

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run src/pages/StaticsPage.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/pages/StaticsPage.tsx src/pages/StaticsPage.css src/pages/StaticsPage.test.tsx
git commit -m "feat(statics): role-aware orchestrator + login + forced password-change modal"
```

---

## Task 20: Verify everything (full lint + typecheck + tests)

**Files:** none touched

- [ ] **Step 1: Run the full Vitest suite**

Run: `npm test`
Expected: PASS (server tests + UI tests).

- [ ] **Step 2: Run client + server typecheck**

Run: `npm run typecheck`
Expected: success on both `tsc --noEmit` and `tsc -p tsconfig.server.json --noEmit`.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: success (no errors).

- [ ] **Step 4: Manually smoke**

```bash
# Terminal A
npm run dev:server

# Terminal B
# 1. open http://localhost:3000/statics
# 2. log in as root / fansea0117 → admin dashboard, no password-change modal
# 3. click 账号 → 新建账号 → create merchant "mike" with password "pw1234", assign p-a
# 4. log out
# 5. log in as mike / pw1234 → forced password-change modal blocks the merchant dashboard
# 6. change password to a new one → landed on merchant dashboard, my data + my products
# 7. edit p-a → reload homepage → name changed
# 8. upload image → reload homepage → image changed AND old file gone from public/products/
# 9. as mike, PUT /api/products/p-b → 403
# 10. reassign p-a from mike to a second merchant → second merchant does not see pre-reassignment events for p-a
```

- [ ] **Step 5: Build**

Run: `npm run build && npm run build:server`
Expected: both produce output (no type errors).

---

## Self-Review Notes

- Spec coverage: each spec section ("User-visible behavior / Data model / Auth flow / API / Frontend structure / Out of scope / Migration notes / Testing strategy") is covered by one or more tasks above.
- Placeholder scan: all step code blocks contain concrete code; no "TODO" or "implement later" markers remain.
- Type consistency: `clearSessionForUser` / `clearSessionForCurrentToken` are used everywhere they appear; `Me.mustChangePassword: boolean`, `MerchantSummary.totals.myClicks`, `AdminUserView.products: string[]` match between Task 4 (server) → Tasks 9–11 (api client) → Tasks 14–19 (UI).
