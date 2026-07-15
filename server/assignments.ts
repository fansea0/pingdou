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