# Multi-account analytics with merchant scoping

## Goal

Replace the single shared admin password with a per-user account system on the `/statics` page. Each merchant gets their own account bound to one or more products; when they log in they see their own product click data and the site's total PV, and they can edit the products currently assigned to them. The system admin (a single `root` account) keeps the original full-fleet analytics view and adds a user-management panel and full product CRUD.

Out of scope (YAGNI): multi-admin, email/SMS reset, password-strength enforcement beyond a minimum length, self-service "forgot password" flow, audit logging, data export.

## User-visible behavior

### Login

The `/statics` page shows a single login form with **username + password**.

After successful login the page routes by role:

- **Admin** (`role = 'admin'`) sees two tabs:
  - **Stats** — same content as today: PV, UV, product-click ranking, daily chart, image-export count, time-range selector.
  - **Users** — a list of all accounts (admin + merchants) with per-row actions: 重置密码, 续期, 禁用, 启用, 删除. A "新建账号" button opens a modal.
- **Merchant** (`role = 'merchant'`) sees a single dashboard:
  - Header: greeting + "修改密码" button.
  - Cards: "我的商品点击" (sum across assigned products in the current assignment window), "站点总 PV" (global, not filtered), "我的商品数".
  - Day chart: per-day `product-click` count for assigned products in the current window.
  - Table: per-product breakdown (product id → clicks). Each row has an "编辑" button opening the product-edit modal.
  - No user-management UI, no view of other merchants' data.

### First-login password change

When a merchant is created the admin enters a temporary password and `must_change_password = 1` is set on the row. On the merchant's first successful login, the page renders a password-change modal that **cannot be dismissed** until the password is updated. After change, `must_change_password = 0`.

In the modal the merchant enters the temporary password as "current password" plus a new password. After save `must_change_password = 0` and the modal closes.

Admin accounts do not go through this flow; their passwords are set by the admin directly.

### Disabled or expired accounts

A disabled or expired account cannot log in (`POST /api/auth/login` returns 401 with a reason). Any pre-existing cookie for that account stops working on the next request — the server reads `users.disabled` and `users.expires_at` on every authenticated request, so disabling takes effect immediately.

### Logout

`POST /api/auth/logout` clears the `statics_token` cookie and deletes the `auth_tokens` row. The next request redirects to the login form.

## Data model

Two new tables. The existing `events` and `sessions` tables are unchanged.

### `users`

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- format: scrypt$<saltHex>$<hashHex>
  role TEXT NOT NULL CHECK(role IN ('admin','merchant')),
  disabled INTEGER NOT NULL DEFAULT 0,   -- 0 active, 1 disabled
  must_change_password INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,                    -- unix ms; NULL = never expires (admin)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- One row per account.
- Admin's `expires_at` is NULL; merchants usually have one.
- Password format: `scrypt$<saltHex>$<hashHex>` using Node's built-in `crypto.scryptSync`.

### `product_assignments`

```sql
CREATE TABLE product_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,              -- matches public/data/products.json
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at INTEGER NOT NULL,
  revoked_at INTEGER                     -- NULL = active
);

-- Only one active assignment per product at a time
CREATE UNIQUE INDEX idx_active_assignment
  ON product_assignments(product_id) WHERE revoked_at IS NULL;
```

A product's current owner is the row where `revoked_at IS NULL`. Reassigning a product:

1. UPDATE the old row: `revoked_at = <now>`.
2. INSERT a new row with the new `user_id`, `assigned_at = <now>`, `revoked_at = NULL`.

The unique index enforces that no two merchants hold the same product at the same instant.

### `auth_tokens`

```sql
CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,           -- sha256(cookie value)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);
```

A token row is created on every successful login and deleted on logout / user disable / password reset. The cookie carries the raw token (32 random bytes, hex); the DB stores only its sha256 hash so a leaked DB doesn't yield working sessions.

## Auth flow

### Login

```
POST /api/auth/login { username, password }
  -> lookup users by username
  -> if not found OR disabled OR expired → 401 with reason
  -> verify password against password_hash (scrypt + timingSafeEqual)
  -> if mismatch → 401 "invalid credentials"
  -> generate 32-byte random token, sha256 it
  -> INSERT auth_tokens(token_hash, user_id, expires_at=now+12h)
  -> set cookie statics_token=<raw>, statics_token_expires=<now+12h>
  -> respond { ok, role, username, mustChangePassword, expiresAt }
```

Generic error: any failure on lookup OR verify returns 401 with a single message `invalid credentials`, except disabled/expired which use a distinct reason so the user knows to contact admin.

### Authenticated request

```
requireAuth middleware:
  read cookies → get token + expires_at
  if expires_at < now → 401
  hash token → lookup auth_tokens
  if no row OR expires_at < now → 401
  lookup users by user_id
  if not found OR disabled → 401
  if expires_at set AND < now → 401
  attach (req).user = { id, role, username, mustChangePassword }
  next()
```

One DB lookup per authenticated request (`auth_tokens` join `users`). Acceptable at this scale (3-5 merchants, low QPS).

### Disable / password reset immediate effect

Disabling a user or resetting their password does **not** require deleting `auth_tokens` rows — the auth middleware re-reads `users.disabled` on every request, so disable takes effect on the next API call (≈ immediate for the user). Password reset does require deleting the user's `auth_tokens` rows so that the cookie's existing token can't continue to authenticate.

### Bootstrap

On server start, if `users` table is empty, the server inserts:

```
INSERT INTO users(username, password_hash, role, created_at, updated_at)
VALUES ('root', scryptHash('fansea0117'), 'admin', now, now)
```

`fansea0117` is a hardcoded string per user instruction. The server logs `[pingdou-server] seeded default admin (root)`. Admin can change the root password later via the user-management panel.

The existing `STATICS_PASSWORD` env-var path is **removed**. Server start no longer reads `~/.bashrc` or `.env` for password; the env-var fallback stays in code as a no-op for now and will be deleted in a follow-up.

## API

All paths prefixed with `/api/`. All responses JSON. All write endpoints expect `Content-Type: application/json`.

### Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/login` | `{username, password}` | `{ok, role, username, mustChangePassword, expiresAt}` |
| POST | `/auth/logout` | — | `{ok}` (clears cookie, deletes token row) |
| GET | `/auth/me` | — | `{id, username, role, mustChangePassword, expiresAt?}` |
| POST | `/auth/change-password` | `{currentPassword, newPassword}` | `{ok}` (requires auth, clears all own tokens) |

### Stats

| Method | Path | Role | Returns |
|---|---|---|---|
| GET | `/statics/summary?days=N` | any | role-specific payload (see below) |
| GET | `/statics/status` | any | `{ok}` (used to validate cookie on page load) |

#### Admin summary

Same shape as today:

```ts
{
  totals: { pageView, productClick, imageExport, uv },
  perDay: [{ day, total }],            // all events
  productClicks: [{ ref, total }]
}
```

#### Merchant summary

```ts
{
  totals: {
    pageView: number,                  // all page-view events, site-wide
    myClicks: number,                  // product-click events in current assignment window for assigned products
    productCount: number
  },
  perDay: [{ day, myClicks: number }], // daily breakdown of myClicks
  productBreakdown: [{ productId, total }] // per-product totals
}
```

The `myClicks` and `productBreakdown` queries join `events` to `product_assignments` filtered by `user_id = <merchant>` and the current assignment window:

```sql
SELECT e.ref, COUNT(*) AS total
FROM events e
JOIN product_assignments pa ON pa.product_id = e.ref
WHERE e.kind = 'product-click'
  AND pa.user_id = ?
  AND e.created_at >= pa.assigned_at
  AND (pa.revoked_at IS NULL OR e.created_at < pa.revoked_at)
  AND e.created_at >= ?   -- window start (now - days*86400000)
GROUP BY e.ref
```

If a product has been reassigned, the new merchant sees only events with `created_at >= new.assigned_at AND (revoked_at IS NULL OR created_at < revoked_at)`. Old events stay in the table for the admin's full-fleet view but are invisible to merchants.

### Admin: user management

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/users` | — | `[{id, username, role, disabled, mustChangePassword, expiresAt?, createdAt, products:[id,...]}]` |
| POST | `/admin/users` | `{username, password, role, productIds: string[], expiresAt?: number\|null, mustChangePassword?: boolean}` | `{id, ...}` (newly created) |
| PATCH | `/admin/users/:id` | `{password?, disabled?, expiresAt?: number\|null, mustChangePassword?, productIds?}` | `{ok}` (also: if `password` changed, deletes user's `auth_tokens`; if `disabled` set, same) |
| DELETE | `/admin/users/:id` | — | `{ok}` (cascades assignments + tokens) |
| POST | `/admin/users/:id/reset-password` | `{newPassword}` | `{ok}` (deletes user's tokens) |

Constraints enforced server-side:
- Username must be unique (DB unique index, case-sensitive).
- Cannot delete the only remaining admin (`root`): returns 409.
- Cannot demote `root` to merchant.
- `productIds` must reference products that exist in `public/data/products.json` (server reads this file once on boot, then re-reads on every product-write endpoint).

#### PATCH `productIds` semantics

When the admin PATCHes a merchant's `productIds`, the server reconciles against the merchant's currently active assignments (rows where `revoked_at IS NULL`):

- For every product in the **new** `productIds` list that is **not** in the old active list: insert a new assignment row with `assigned_at = now`, `revoked_at = NULL`.
- For every product in the **old** active list that is **not** in the new list: set `revoked_at = now` on the existing row (do **not** delete — historical isolation must be preserved).
- Products present in both lists: untouched.

This reconciliation is performed in a single SQLite transaction. If `productIds` is omitted from the PATCH body, assignments are unchanged.

### Product editing (admin + merchant)

Admins and merchants can both edit product information. **Scope**: a merchant may only edit a product currently assigned to them. The admin may edit any product.

Editable fields: `name`, `description`, `price`, `url`, `badge` (any of these can be `null` / empty for badge). Image is handled via a separate upload endpoint, not embedded in the JSON body.

`products.json` remains the source of truth for product data. The server reads and writes this file under `public/data/products.json`. Image files live under `public/products/`.

| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| GET | `/api/products` | any | — | `[{id, name, image, price, currency, description, url, badge?}]`. For merchants, only products currently assigned to them (active assignment, `revoked_at IS NULL`). |
| PUT | `/api/products/:id` | admin or owner-merchant | `{name?, description?, price?, url?, badge?}` | full updated product row. Returns 403 if merchant is not currently assigned to the product. |
| POST | `/api/products/:id/image` | admin or owner-merchant | multipart/form-data with field `file` (image/jpeg, image/png, image/webp; ≤ 5 MB) | `{image: "/products/<filename>"}` (new path). Returns 403 if merchant is not currently assigned to the product. |
| POST | `/api/products` | admin only | `{id, name, image, price, currency, description, url, badge?}` | full new product row. Validates `id` is unique and matches `^[a-z0-9-]+$`. Writes a placeholder image if `image` is missing. A new product is **not assigned** to any merchant; the admin assigns it later via `PATCH /admin/users/:id {productIds: [...]}` or by including it on user creation. Until assigned, only the admin sees it. |
| DELETE | `/api/products/:id` | admin only | — | `{ok}`. Also deletes the image file from disk and revokes all current assignments. Historical events for the product stay in the events table (so admin's full-fleet stats remain intact) but no longer surface to any merchant. |

#### Image upload semantics

1. Server validates content-type and size. Rejects with 400 on mismatch.
2. Generates a unique filename: `<product-id>-<randomHex>.<ext>`. The `<product-id>` prefix keeps the directory tidy (one image per product).
3. Saves the uploaded file under `public/products/`.
4. **If the product already has an image file** (i.e., `image` field is non-empty AND resolves to an existing file under `public/products/`), deletes the old file after the new one is safely written. Failures to delete the old file are logged but do not fail the request.
5. Updates the `image` field in `products.json` to the new path.
6. Persists `products.json` atomically (write to `products.json.tmp`, then `rename`).

#### `products.json` write atomicity

Every write to `products.json` is performed as:

1. Read current file.
2. Apply mutation in memory.
3. Write to `products.json.tmp`.
4. `rename` tmp → real path (atomic on POSIX).

On startup the server reads `products.json` once and caches the parsed JSON in memory; subsequent product-write endpoints read+write through this cache so concurrent edits don't clobber each other. The cache is reloaded on a 1-second debounce after a write.

For this scale (3-5 merchants, low write frequency) the cache + atomic write is sufficient; no need for a database table for products.

#### Authorization helper

A small helper `requireProductAccess(req, productId)` checks:

- If `req.user.role === 'admin'`: allow.
- Else: query `product_assignments` for active row with `(product_id = productId, user_id = req.user.id, revoked_at IS NULL)`. Allow if found, else 403.

This is the single chokepoint used by every product-edit endpoint.

## Frontend structure

```
src/pages/StaticsPage.tsx                  — orchestrator: fetches /me, routes by role
src/pages/admin/AdminDashboard.tsx         — wraps stats + users + products tabs
src/pages/admin/UsersTab.tsx               — user table + new-user modal + edit modal
src/pages/admin/StatsTab.tsx               — current StaticsPage dashboard body
src/pages/admin/ProductsTab.tsx            — full product table + create/delete (admin only)
src/pages/merchant/MerchantDashboard.tsx   — merchant view + product table (own only)
src/components/ProductEditModal.tsx        — shared product-edit form (text fields + image upload)
src/components/ChangePasswordModal.tsx     — used by both admin (self) and merchant (forced on first login)
```

The product-edit modal handles both text-field updates (`PUT /api/products/:id`) and image upload (`POST /api/products/:id/image`) with a single Save button.

For image upload: a `<input type="file" accept="image/*">` triggers `POST /api/products/:id/image` with FormData. On success, the modal re-fetches the product row and updates its preview thumbnail.

Reuse `src/api/statics.ts` for fetch wrappers; add new functions (`adminListUsers`, `adminCreateUser`, `listProducts`, `updateProduct`, `uploadProductImage`, etc.).

When `mustChangePassword = true` after login, the page renders `<ChangePasswordModal required>` over the dashboard with a backdrop that doesn't close on click-outside.

## Out of scope (YAGNI)

- Multi-admin (the only admin is `root`, hardcoded seed).
- Email/SMS password reset (admin resets manually via UI).
- Password complexity rules beyond length minimum (≥ 4 chars, matching current).
- Self-service "forgot password" link.
- Audit log of admin actions.
- Data export (CSV download of stats).
- Backups of `data/stats.db` or `public/data/products.json`. (Operational concern; we mention it but do not implement scheduled backups.)
- Image cropping / resizing server-side. We trust the merchant to upload reasonable images; recommend ≤ 1 MB.
- CDN / external image hosting. All images stay in `public/products/`.
- Multi-image per product. One product ↔ one image.

## Migration notes

Existing deployments:

1. Existing `STATICS_PASSWORD` env var is **no longer read** for auth. Remove it from `.bashrc` / `.env` to avoid confusion.
2. The legacy `/api/auth/login` body `{password}` is replaced with `{username, password}`.
3. The legacy cookie names (`statics_token`, `statics_token_expires`) stay the same, so existing browsers will just be logged out once.
4. `public/data/products.json` and `public/products/` are read+written by the new endpoints; the existing files stay the source of truth until the first edit.
5. The product images on disk remain valid; the file-naming convention is now `<product-id>-<randomHex>.<ext>` for new uploads.

The existing `events` and `sessions` tables are untouched; only `users`, `product_assignments`, and `auth_tokens` are new.

## Testing strategy

- Unit: scrypt hash + verify; token generation; assignment-window filter SQL; disabled-account rejection; expired-account rejection; product authorization helper.
- Integration: full login → /me → summary → logout flow for both roles via the actual Express routes + sqlite test DB.
- Integration: product-edit endpoints — admin can edit any product; merchant can edit only their own; image upload writes to disk, deletes the old file, and updates `products.json`; concurrent edits do not clobber each other (atomic write).
- Manual smoke:
  - Log in as root, create a merchant with 2 products, log out.
  - Log in as merchant, confirm they see only their products' data and the site PV.
  - As merchant, edit product name → reload homepage → name changed.
  - As merchant, upload a new image → reload homepage → image changed AND old file removed from `public/products/`.
  - As merchant, try to PUT a product not assigned to them → 403.
  - Reassign one product to a second merchant, confirm second merchant does not see pre-reassignment events for that product.

## Open questions

None — all design questions answered during brainstorming.
