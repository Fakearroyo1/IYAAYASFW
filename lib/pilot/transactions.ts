import {
  type DB,
  type Row,
  fail,
  int,
  str,
  uid,
  reqId,
  first,
  rows,
  stmt,
  audit,
  guard,
  hash,
} from "./core";
import { ledger, cashReference } from "./balances";
import { EarningPlan } from "./earning";
type Atomic = (db: DB, statements: D1PreparedStatement[]) => Promise<unknown>;

export async function applyCredit(db: DB, m: Row, b: Row, atomic: Atomic) {
  const id = reqId(b.id),
    amount = int(b.amount, 1, 50000),
    fp = await hash({ actor: m.id, action: "creditSettlement", amount });
  const duplicate = async () => {
    const old = await first(db, "SELECT * FROM payments WHERE id=?", id);
    if (old && old.fingerprint !== fp)
      fail("This action identifier was already used.", 409);
    return old;
  };
  const old = await duplicate();
  if (old) return { payment: old, replayed: true };
  const time = Date.now();
  const earning = await EarningPlan.load(db, m.id, "payment:" + id, "credit_settlement", time);
  earning.settle(amount, earning.spendCredit(amount));
  try {
    await atomic(db, [
      ...earning.prefixes,
      guard(
        db,
        "EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND debt>=? AND credit>=?)",
        m.id,
        amount,
        amount,
      ),
      stmt(
        db,
        "UPDATE members SET debt=debt-?,credit=credit-?,due_since=CASE WHEN debt-?=0 THEN NULL ELSE due_since END WHERE id=?",
        amount,
        amount,
        amount,
        m.id,
      ),
      stmt(
        db,
        "INSERT INTO payments(id,fingerprint,member_id,purpose,method,amount,status,reference,verified_by,created_at,verified_at) VALUES(?,?,?,'settlement','credit',?,'verified',?,?,?,?)",
        id,
        fp,
        m.id,
        amount,
        "CREDIT-" + id,
        m.id,
        time,
        time,
      ),
      ...earning.finish(),
      ledger(
        db,
        m.id,
        m.id,
        "credit_settlement",
        -amount,
        -amount,
        "Confirmed credit applied to tab.",
        null,
        id,
      ),
      audit(db, m.id, "credit_applied_to_tab", id, { amount }),
    ]);
  } catch (e) {
    const retry = await duplicate();
    if (retry) return { payment: retry, replayed: true };
    throw e;
  }
  return {
    payment: await first(db, "SELECT * FROM payment_balances WHERE id=?", id),
  };
}

export async function verifyPayment(db: DB, m: Row, b: Row, atomic: Atomic) {
  const p = await first(
    db,
    "SELECT * FROM payment_balances WHERE id=?",
    str(b.id, 40),
  );
  if (!p) fail("Payment not found.", 404);
  if (p.status === "verified")
    return { ok: true, replayed: true, reference: p.reference };
  if (p.status !== "pending" || p.amount <= 0)
    fail("This payment is no longer awaiting confirmation.", 409);
  if (b.confirmed !== true)
    fail("Confirm that you have actually received this payment.");
  const reference =
    p.method === "cash"
      ? cashReference()
      : str(b.reference || "", 100).toLowerCase();
  if (!reference) fail("Enter the Cash App transaction ID.");
  const received = int(b.amountReceived ?? p.amount, 1, 50000);
  const member = p.member_id
    ? await first(db, "SELECT * FROM members WHERE id=?", p.member_id)
    : null;
  if (!member && received !== p.amount)
    fail(
      "Confirm the exact guest sale amount. Record a separate sale for additional items.",
    );
  if (p.purpose === "purchase" && received < p.amount)
    fail(
      "A purchase needs its full remaining payment. Review the sale if the amount is incorrect.",
    );
  let debtApplied = 0,
    creditAdded = 0;
  if (p.purpose === "settlement") {
    if (!member) fail("Member not found.", 404);
    debtApplied = Math.min(received, member.debt);
    creditAdded = received - debtApplied;
  } else if (p.purpose === "topup") {
    if (!member) fail("Member not found.", 404);
    creditAdded = received;
  } else if (p.purpose === "purchase") creditAdded = received - p.amount;
  else fail("This payment cannot be confirmed here.");
  // The UI confirms the actual amount and previews any excess becoming credit.
  if (b.expectedCredit !== undefined && int(b.expectedCredit) !== creditAdded)
    fail("The balance changed. Review the confirmation again.", 409);
  const earning = member && p.purpose !== "topup"
    ? await EarningPlan.load(db, member.id, "payment:" + p.id, "payment_confirmed") : null;
  if (p.purpose === "settlement") earning?.settle(debtApplied);
  else if (p.purpose === "purchase" && p.order_id) earning?.confirmPurchase(p.order_id, p.amount);
  const statements = [
    ...(earning?.prefixes || []),
    guard(
      db,
      "EXISTS(SELECT 1 FROM payment_balances WHERE id=? AND status='pending' AND amount=?)",
      p.id,
      p.amount,
    ),
  ];
  if (member) {
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM members WHERE id=? AND debt=? AND credit=?)",
        member.id,
        member.debt,
        member.credit,
      ),
      stmt(
        db,
        "UPDATE members SET debt=debt-?,credit=credit+?,due_since=CASE WHEN debt-?=0 THEN NULL ELSE due_since END WHERE id=?",
        debtApplied,
        creditAdded,
        debtApplied,
        member.id,
      ),
    );
  }
  if (p.order_id)
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM orders WHERE id=? AND status='pending')",
        p.order_id,
      ),
      stmt(db, "UPDATE orders SET status='paid' WHERE id=?", p.order_id),
    );
  if(b.effectiveAt!==undefined){
    const effective=int(b.effectiveAt,0,Date.now()+60000);
    statements.push(stmt(db,'INSERT INTO payment_receipt_times(payment_id,effective_at,known) VALUES(?,?,1)',p.id,effective));
  }
  statements.push(
    stmt(
      db,
      "INSERT INTO payment_confirmations(payment_id,received_amount,debt_applied,credit_added) VALUES(?,?,?,?)",
      p.id,
      received,
      debtApplied,
      creditAdded,
    ),
    stmt(
      db,
      "UPDATE payments SET status='verified',reference=?,verified_by=?,verified_at=? WHERE id=?",
      reference,
      m.id,
      Date.now(),
      p.id,
    ),
  );
  if (earning) statements.push(...earning.finish());
  if (member && (debtApplied || creditAdded))
    statements.push(
      ledger(
        db,
        member.id,
        m.id,
        "payment_confirmed",
        -debtApplied,
        creditAdded,
        "Receipt " + reference,
        p.order_id,
        p.id,
      ),
    );
  statements.push(
    audit(db, m.id, "payment_verified", p.id, {
      reference,
      reportedAmount: p.original_amount,
      remainingAmount: p.amount,
      received,
      debtApplied,
      creditAdded,
      method: p.method,
      purpose: p.purpose,
    }),
  );
  await atomic(db, statements);
  return { ok: true, reference, creditAdded, debtApplied };
}

export async function transactionDetail(db: DB, id: string) {
  const order = await first(
    db,
    "SELECT * FROM order_balances WHERE id=?",
    str(id, 80),
  );
  if (!order) fail("Purchase not found.", 404);
  const [items, payments, adjustments, member] = await Promise.all([
    rows(
      db,
      "SELECT * FROM item_balances WHERE order_id=? ORDER BY name,id",
      id,
    ),
    rows(
      db,
      "SELECT p.*,m.name verified_name FROM payment_balances p LEFT JOIN members m ON m.id=p.verified_by WHERE p.order_id=? ORDER BY p.created_at,p.id",
      id,
    ),
    rows(
      db,
      "SELECT a.*,m.name actor_name FROM transaction_adjustments a LEFT JOIN members m ON m.id=a.actor WHERE a.order_id=? ORDER BY a.created_at,a.id",
      id,
    ),
    order.member_id
      ? first(
          db,
          "SELECT id,name,debt,credit FROM members WHERE id=?",
          order.member_id,
        )
      : Promise.resolve(null),
  ]);
  return { order, items, payments, adjustments, member };
}

// Refunds of tab purchases first offset current debt, then return any remainder.
// Historical settlement allocation is deliberately not reconstructed or invented.
export function correctionAmounts(
  order: Row,
  items: Row[],
  selection: Row[],
  member: Row | null,
  pendingAmount: number,
) {
  let total = 0,
    tax = 0,
    cost: number | null = 0;
  for (const selected of selection) {
    const item = items.find((i) => i.id === selected.id);
    if (!item) fail("Choose an item on this purchase.");
    const qty = int(selected.qty, 1, item.remaining_qty);
    total += qty * item.price;
    tax +=
      Math.round(
        (item.price * (item.corrected_qty + qty) * item.tax_bp) /
          (10000 + item.tax_bp),
      ) -
      Math.round(
        (item.price * item.corrected_qty * item.tax_bp) / (10000 + item.tax_bp),
      );
    cost = cost === null || item.cost === null ? null : cost + qty * item.cost;
  }
  const pendingReduced = Math.min(total, pendingAmount),
    debtReduced = member
      ? Math.min(
          total - pendingReduced,
          Math.max(0, order.tab_added - order.debt_reduced),
          member.debt,
        )
      : 0;
  return {
    total,
    tax,
    cost,
    pendingReduced,
    debtReduced,
    toReturn: total - pendingReduced - debtReduced,
  };
}

export async function correctTransaction(
  db: DB,
  m: Row,
  b: Row,
  atomic: Atomic,
) {
  const { order, items, payments, member } = await transactionDetail(
    db,
    str(b.id, 80),
  );
  if (order.status === "void" || order.total <= 0)
    fail("This purchase has already been voided.", 409);
  if (int(b.revision) !== order.revision)
    fail("The purchase changed. Review it again.", 409);
  const reason = str(b.reason || "", 500);
  if (reason.length < 5) fail("Record a clear reason for this correction.");
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 60)
    fail("Select the items and quantities to reverse.");
  const selection = b.items.map((i: Row) => ({
    id: str(i.id, 80),
    qty: int(i.qty, 1, 100000),
    restock: i.restock === true,
  }));
  if (new Set(selection.map((i: Row) => i.id)).size !== selection.length)
    fail("Select each sale line once.");
  const pending = payments.find(
    (p) => p.purpose === "purchase" && p.status === "pending",
  );
  const amounts = correctionAmounts(
    order,
    items,
    selection,
    member,
    pending?.amount || 0,
  );
  if (
    int(b.expectedTotal) !== amounts.total ||
    int(b.expectedDebtReduction) !== amounts.debtReduced ||
    int(b.expectedReturn) !== amounts.toReturn
  )
    fail("The balances changed. Review the correction preview again.", 409);
  const refundMethod = amounts.toReturn
    ? str(b.refundMethod || "", 20)
    : "none";
  if (amounts.toReturn && !["credit", "cash", "cashapp"].includes(refundMethod))
    fail("Choose how to return the paid portion.");
  if (refundMethod === "credit" && !member)
    fail(
      "Guests do not have credit accounts. Choose a cash or Cash App refund.",
    );
  if (b.confirmed !== true)
    fail("Confirm the correction and any external refund before saving.");
  const reference =
    refundMethod === "cash"
      ? cashReference()
      : refundMethod === "cashapp"
        ? str(b.reference || "", 100).toLowerCase()
        : null;
  if (refundMethod === "cashapp" && !reference)
    fail("Enter the Cash App refund transaction ID.");
  const id = reqId(b.requestId),
    creditReturned = refundMethod === "credit" ? amounts.toReturn : 0,
    externalRefund = ["cash", "cashapp"].includes(refundMethod)
      ? amounts.toReturn
      : 0;
  const earning = member
    ? await EarningPlan.load(db, member.id, "correction:" + id, "purchase_correction", Date.now(), order.id) : null;
  earning?.correct(order.id, amounts, refundMethod);
  const statements = [
    ...(earning?.prefixes || []),
    guard(
      db,
      "EXISTS(SELECT 1 FROM order_balances WHERE id=? AND revision=? AND status=? AND total=?)",
      order.id,
      order.revision,
      order.status,
      order.total,
    ),
  ];
  if (member)
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM members WHERE id=? AND debt=? AND credit=?)",
        member.id,
        member.debt,
        member.credit,
      ),
    );
  if (pending)
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM payment_balances WHERE id=? AND status='pending' AND amount=?)",
        pending.id,
        pending.amount,
      ),
    );
  statements.push(
    stmt(
      db,
      "INSERT INTO transaction_adjustments(id,order_id,actor,reason,created_at,total,tax,cost,debt_reduced,credit_returned,pending_reduced,external_refund,refund_method) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      order.id,
      m.id,
      reason,
      Date.now(),
      amounts.total,
      amounts.tax,
      amounts.cost,
      amounts.debtReduced,
      creditReturned,
      amounts.pendingReduced,
      externalRefund,
      refundMethod,
    ),
  );
  for (const selected of selection) {
    const item = items.find((i) => i.id === selected.id)!;
    if (selected.restock && (item.custom || item.preorder))
      fail("Custom charges and preorders do not restore stocked inventory.");
    statements.push(
      stmt(
        db,
        "INSERT INTO transaction_adjustment_items(adjustment_id,item_id,qty,restock) VALUES(?,?,?,?)",
        id,
        item.id,
        selected.qty,
        selected.restock ? 1 : 0,
      ),
    );
    if (selected.restock)
      statements.push(
        item.variant_id
          ? stmt(
              db,
              "UPDATE product_variants SET stock=stock+?,version=version+1 WHERE id=?",
              selected.qty,
              item.variant_id,
            )
          : stmt(
              db,
              "UPDATE products SET stock=stock+?,version=version+1 WHERE id=?",
              selected.qty,
              item.product_id,
            ),
      );
  }
  if (member && (amounts.debtReduced || creditReturned))
    statements.push(
      stmt(
        db,
        "UPDATE members SET debt=debt-?,credit=credit+?,due_since=CASE WHEN debt-?=0 THEN NULL ELSE due_since END WHERE id=?",
        amounts.debtReduced,
        creditReturned,
        amounts.debtReduced,
        member.id,
      ),
      ledger(
        db,
        member.id,
        m.id,
        "purchase_reversed",
        -amounts.debtReduced,
        creditReturned,
        reason,
        order.id,
      ),
    );
  if (pending && amounts.pendingReduced === pending.amount)
    statements.push(
      stmt(db, "UPDATE payments SET status='rejected' WHERE id=?", pending.id),
    );
  if (amounts.total === order.total)
    statements.push(
      stmt(db, "UPDATE orders SET status='void' WHERE id=?", order.id),
    );
  else if (pending && amounts.pendingReduced === pending.amount)
    statements.push(
      stmt(db, "UPDATE orders SET status='paid' WHERE id=?", order.id),
    );
  if (amounts.toReturn) {
    const paymentId = uid(),
      time = Date.now();
    statements.push(
      stmt(
        db,
        "INSERT INTO payments(id,fingerprint,order_id,member_id,purpose,method,amount,status,reference,verified_by,created_at,verified_at) VALUES(?,?,?,?,'refund',?,?,'verified',?,?,?,?)",
        paymentId,
        await hash({ adjustment: id }),
        order.id,
        order.member_id,
        refundMethod,
        amounts.toReturn,
        reference || "CREDIT-" + paymentId,
        m.id,
        time,
        time,
      ),
    );
  }
  if (earning) statements.push(...earning.finish());
  statements.push(
    audit(db, m.id, "purchase_corrected", order.id, {
      adjustmentId: id,
      reason,
      items: selection,
      ...amounts,
      refundMethod,
      reference,
    }),
  );
  await atomic(db, statements);
  return { ok: true, adjustmentId: id, reference };
}
