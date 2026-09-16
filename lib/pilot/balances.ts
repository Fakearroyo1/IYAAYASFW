import { type DB, first, stmt, uid } from "./core";
export const TAB_REMINDER = 2000;
export const TAB_HARD_LIMIT = 3000;
export async function controls(db: DB, memberId: string) {
  return (
    (await first(
      db,
      "SELECT * FROM member_controls WHERE member_id=?",
      memberId,
    )) || { tab_limit: TAB_HARD_LIMIT, posting_enabled: 1, version: 0 }
  );
}
export function ledger(
  db: DB,
  memberId: string,
  actor: string,
  kind: string,
  debt: number,
  credit: number,
  note: string,
  orderId: string | null = null,
  paymentId: string | null = null,
) {
  return stmt(
    db,
    "INSERT INTO balance_ledger(id,member_id,order_id,payment_id,kind,debt_delta,credit_delta,actor,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    uid(),
    memberId,
    orderId,
    paymentId,
    kind,
    debt,
    credit,
    actor,
    note,
    Date.now(),
  );
}
export const cashReference = () => "CASH-" + crypto.randomUUID().toUpperCase();
