import type { Tx } from '../lib/audit.js';
import { HttpError, conflict, pgCode } from '../lib/errors.js';

export interface LedgerEntry {
  userId: string | null;
  orgId: string | null;
  appId: string | null;
  actionType: string;
  delta: number;
  referenceId: string;
}

/**
 * Posts to the append-only ledger. The DB trigger picks the account (org pool
 * when orgId is set), locks it, computes balance_after and enforces both the
 * no-overdraft rule and (actionType, referenceId) idempotency.
 */
export async function postLedger(tx: Tx, e: LedgerEntry): Promise<{ id: string; balanceAfter: number }> {
  try {
    const rows = await tx.$queryRaw<{ id: string; balance_after: number }[]>`
      INSERT INTO credit_ledger (user_id, org_id, app_id, action_type, delta, reference_id)
      VALUES (${e.userId}::uuid, ${e.orgId}::uuid, ${e.appId}, ${e.actionType}, ${e.delta}, ${e.referenceId})
      RETURNING id::text, balance_after`;
    const row = rows[0]!;
    return { id: row.id, balanceAfter: Number(row.balance_after) };
  } catch (err) {
    const code = pgCode(err);
    if (code === '23514') throw new HttpError(402, 'INSUFFICIENT_CREDITS', 'Not enough compute credits for this action');
    if (code === '23505') throw conflict('DUPLICATE_LEDGER_ENTRY', 'This charge was already recorded');
    if (code === '23503') throw new HttpError(403, 'NOT_ORG_MEMBER', 'User is not a member of that organisation');
    throw err;
  }
}

/** True when an entry with this idempotency key already exists for the owner. */
export async function ledgerEntryExists(tx: Tx, owner: { userId: string | null; orgId: string | null }, actionType: string, referenceId: string) {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM credit_ledger l
      JOIN credit_accounts a ON a.id = l.account_id
     WHERE l.action_type = ${actionType} AND l.reference_id = ${referenceId}
       AND (CASE WHEN ${owner.orgId}::uuid IS NOT NULL THEN a.org_id = ${owner.orgId}::uuid ELSE a.user_id = ${owner.userId}::uuid END)`;
  return Number(rows[0]?.n ?? 0) > 0;
}
