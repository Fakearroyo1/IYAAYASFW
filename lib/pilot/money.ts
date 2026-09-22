import {
  type DB,
  type Row,
  first,
  rows,
  stmt,
  guard,
  fail,
  int,
  str,
  audit,
} from "./core";
import { operation, noteText } from "./operation";
import { dateRange, cursorValue, cursorFor } from "./history";

export const MONEY_ACTIONS = [
  "moneyCheck",
  "moneyTransfer",
  "moneyExpense",
  "moneyAdjustment",
  "moneyAccount",
  "moneyCommitment",
  "moneySettle",
  "moneySelectRun",
];
export const effectiveTime = (value: unknown, now = Date.now()) =>
  int(value, 0, now + 60000);
export async function accountGuard(db: DB, id: unknown) {
  const account = str(id, 80);
  if (
    !(await first(
      db,
      "SELECT id FROM money_accounts WHERE id=? AND active=1",
      account,
    ))
  )
    fail("Select the activity account actually used.");
  return {
    account,
    statement: guard(
      db,
      "EXISTS(SELECT 1 FROM money_accounts WHERE id=? AND active=1)",
      account,
    ),
  };
}
export function movement(
  db: DB,
  value: {
    id: string;
    account: string;
    amount: number;
    category: string;
    sourceType: string;
    sourceId: string;
    effective: number;
    actor: string;
    reference?: string;
    transfer?: string;
  },
) {
  return stmt(
    db,
    "INSERT INTO money_movements(id,account_id,amount,category,source_type,source_id,effective_at,posted_at,effective_known,actor,reference,transfer_id) VALUES(?,?,?,?,?,?,?,?,1,?,?,?)",
    value.id,
    value.account,
    value.amount,
    value.category,
    value.sourceType,
    value.sourceId,
    value.effective,
    Date.now(),
    value.actor,
    value.reference || "",
    value.transfer || null,
  );
}
export async function moneySummary(db: DB, at = Date.now()) {
  const accounts = await rows(
    db,
    `SELECT a.*,o.id observation_id,o.amount checked_amount,o.observed_at,o.created_at checked_posted_at,o.actor,o.reviewer,o.note,o.ledger_complete,o.source_type observation_source FROM money_accounts a LEFT JOIN money_observations o ON o.id=(SELECT id FROM money_observations WHERE account_id=a.id AND observed_at<=? ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1) ORDER BY a.id`,
    at,
  );
  for (const a of accounts) {
    a.balance = a.checked_amount ?? null;
    a.basis = "Last checked";
    a.recorded_change = null;
    if (a.observation_id) {
      const change = await first(
        db,
        `SELECT COALESCE(SUM(CASE WHEN effective_at>? THEN amount ELSE 0 END),0) amount,COALESCE(SUM(effective_known=0 OR (effective_at=? AND posted_at>?)),0) uncertain FROM money_movements m WHERE account_id=? AND effective_at>=? AND effective_at<=? AND NOT EXISTS(SELECT 1 FROM money_observation_coverage c WHERE c.observation_id=? AND m.source_type='payment' AND c.payment_id=m.source_id)`,
        a.observed_at,
        a.observed_at,
        a.checked_posted_at,
        a.id,
        a.observed_at,
        at,
        a.observation_id,
      );
      const unclassified = await first(
        db,
        `SELECT count(*) n FROM expenses e WHERE e.created_at>? AND e.created_at<=? AND NOT EXISTS(SELECT 1 FROM purchase_receipts r WHERE r.expense_id=e.id) AND NOT EXISTS(SELECT 1 FROM purchase_corrections c WHERE c.id=e.id) AND NOT EXISTS(SELECT 1 FROM money_movements m WHERE m.source_type='expense' AND m.source_id=e.id)`,
        a.observed_at,
        at,
      );
      a.recorded_change = change!.amount;
      a.unclassified_expenses = unclassified!.n;
      a.uncertain_movements = change!.uncertain;
      if (
        a.ledger_complete &&
        change!.uncertain === 0 &&
        unclassified!.n === 0
      ) {
        a.balance += change!.amount;
        a.basis = "Estimated from recorded activity";
      }
    }
  }
  const [owed, reimbursements, commitments, credits] = await Promise.all([
    first(db, "SELECT COALESCE(SUM(debt),0) amount FROM members"),
    rows(
      db,
      `SELECT r.receipt_id,r.purchaser,r.amount,COALESCE((SELECT SUM(amount) FROM reimbursement_settlements s WHERE s.receipt_id=r.receipt_id),0) paid,COALESCE((SELECT SUM(c.refund) FROM purchase_corrections c JOIN purchase_lines l ON l.id=c.purchase_line_id WHERE l.receipt_id=r.receipt_id),0) returned,p.run_id FROM reimbursements r JOIN purchase_receipts p ON p.id=r.receipt_id`,
    ),
    rows(db, `SELECT c.* FROM money_commitments c WHERE status='open'`),
    first(
      db,
      `SELECT COALESCE(SUM(m.credit),0) total,COALESCE(SUM(MIN(m.credit,COALESCE(e.reward_credit_cents,0))),0) reward,COALESCE(SUM(MIN(MAX(0,m.credit-COALESCE(e.reward_credit_cents,0)),MAX(0,COALESCE((SELECT SUM(CASE WHEN l.credit_delta<0 THEN l.credit_delta WHEN p.status='verified' AND p.method IN('cash','cashapp') THEN l.credit_delta ELSE 0 END) FROM balance_ledger l LEFT JOIN payments p ON p.id=l.payment_id WHERE l.member_id=m.id),0)))),0) cash_backed_minimum FROM members m LEFT JOIN earning_accounts e ON e.member_id=m.id`,
    ),
  ]);
  const unpaid = reimbursements
    .map((r) => ({
      ...r,
      remaining: Math.max(0, r.amount - r.paid - r.returned),
    }))
    .filter((r) => r.remaining > 0);
  const included = accounts.filter((a) => a.active && a.kind === "holding"),
    complete =
      included.length > 0 &&
      included.every(
        (a) => a.observation_id && a.observation_source !== "legacy-cashcount",
      );
  const checkedSubtotal = included.reduce(
      (n, a) => n + (a.checked_amount ?? 0),
      0,
    ),
    funds = complete ? included.reduce((n, a) => n + a.balance, 0) : null;
  const held =
    unpaid.reduce((n, r) => n + r.remaining, 0) +
    commitments.reduce((n, c) => n + c.amount, 0);
  const investmentAccounts = accounts.filter(
      (a) => a.active && a.kind === "investment",
    ),
    investments = investmentAccounts.every((a) => a.observation_id)
      ? investmentAccounts.reduce((n, a) => n + a.balance, 0)
      : null;
  const inventory = await first(
    db,
    "SELECT SUM(CASE WHEN cost IS NOT NULL THEN stock*cost ELSE 0 END) known_value,SUM(CASE WHEN cost IS NULL THEN stock ELSE 0 END) unknown_units FROM (SELECT p.stock,p.cost FROM products p WHERE NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id) UNION ALL SELECT v.stock,COALESCE(v.cost,p.cost) FROM product_variants v JOIN products p ON p.id=v.product_id)",
  );
  return {
    inventory,
    investments,
    activityAssets:
      funds === null || investments === null
        ? null
        : funds + investments + owed!.amount,
    assetBasis:
      "Checked/estimated holding accounts plus receivables and recorded investments; inventory is separate. This is not a compliance determination or historical average.",
    accounts,
    complete,
    checkedSubtotal,
    funds,
    held,
    available: funds === null ? null : funds - held,
    tabs: owed!.amount,
    reimbursements: unpaid,
    commitments,
    credits: {
      total: credits!.total,
      reward: credits!.reward,
      cashBackedMinimum: credits!.cash_backed_minimum,
      otherSourceNotEstablished:
        credits!.total - credits!.reward - credits!.cash_backed_minimum,
    },
    commitmentBasis:
      "Recorded commitments only; review credit sources and any unrecorded obligations.",
    reportingTimezone: "UTC",
  };
}
export async function moneyHistory(db: DB, q: Row = {}) {
  const kind = q.kind === "movements" ? "movements" : "observations",
    table = kind === "movements" ? "money_movements" : "money_observations",
    limit = int(Number(q.limit || 30), 1, 100),
    c = cursorValue(q.cursor),
    { start, end } = dateRange(q.from, q.to),
    time = kind === "movements" ? "posted_at" : "created_at",
    effective = kind === "movements" ? "effective_at" : "observed_at";
  const values: unknown[] = [start, end, Number(q.until) || Date.now() + 1],
    where = [`${effective}>=? AND ${effective}<? AND ${time}<?`];
  if (q.account) {
    where.push("account_id=?");
    values.push(str(q.account, 80));
  }
  if (c) {
    where.push(`(${time}<? OR (${time}=? AND id<?))`);
    values.push(c.t, c.t, c.id);
  }
  const found = await rows(
      db,
      `SELECT *,${time} created_at FROM ${table} WHERE ${where.join(" AND ")} ORDER BY ${time} DESC,id DESC LIMIT ?`,
      ...values,
      limit + 1,
    ),
    records = found.slice(0, limit);
  return {
    records,
    nextCursor:
      found.length > limit ? cursorFor(records[records.length - 1]) : null,
  };
}
export async function mutateMoney(db: DB, m: Row, b: Row, token?: string) {
  const op = await operation(db, m, b, true, token);
  if (op.replayed) return { ok: true, replayed: true };
  const now = Date.now(),
    s: D1PreparedStatement[] = [];
  if (b.action === "moneyCheck") {
    if (
      !Array.isArray(b.accounts) ||
      b.accounts.length < 1 ||
      b.accounts.length > 20
    )
      fail(
        "Enter at least one checked account; leave unchecked accounts blank.",
      );
    const revision = (await first(
      db,
      "SELECT version FROM accounting_revision WHERE id='main'",
    ))!.version;
    const summary = await moneySummary(db),
      seen = new Set<string>();
    s.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM accounting_revision WHERE id='main' AND version=?)",
        revision,
      ),
    );
    for (const x of b.accounts) {
      const { account, statement } = await accountGuard(db, x.account),
        amount = int(x.amount, 0, 100000000),
        observed = effectiveTime(x.observedAt, now),
        id = op.id + ":" + account,
        previous = summary.accounts.find((a) => a.id === account);
      if (seen.has(account)) fail("Check each account once.");
      seen.add(account);
      const prior = await first(
        db,
        "SELECT id FROM money_observations WHERE account_id=? ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1",
        account,
      );
      if ((prior?.id || null) !== (x.previousId || null))
        fail(
          "Another balance check was saved. Your amounts are preserved; review the latest check.",
          409,
        );
      if (prior && observed < previous!.observed_at)
        fail("A new balance check cannot precede the latest one.");
      const atCheck = (await moneySummary(db, observed)).accounts.find(
        (a) => a.id === account,
      );
      const expected =
        atCheck?.basis === "Estimated from recorded activity"
          ? atCheck.balance
          : null;
      if (expected !== null && expected !== amount && !str(x.note || "", 500))
        fail("Record a note for the balance difference.");
      s.push(
        statement,
        guard(
          db,
          "COALESCE((SELECT id FROM money_observations WHERE account_id=? ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1),'')=?",
          account,
          prior?.id || "",
        ),
        stmt(
          db,
          "INSERT INTO money_observations(id,account_id,amount,observed_at,created_at,actor,reviewer,expected,difference,note,ledger_complete,source_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          id,
          account,
          amount,
          observed,
          now,
          m.id,
          str(b.reviewer || "", 100),
          expected,
          expected === null ? null : amount - expected,
          str(x.note || "", 500),
          x.ledgerComplete === true ? 1 : 0,
          id,
        ),
      );
      if (
        x.includedPayments !== undefined &&
        !Array.isArray(x.includedPayments)
      )
        fail("Select included payment reports.");
      const ids = [...new Set<string>(x.includedPayments || [])];
      if (ids.length > 100)
        fail("Review no more than 100 payment reports per check.");
      for (const paymentId of ids) {
        const p = await first(
          db,
          "SELECT id FROM payments WHERE id=? AND method=? AND status IN('pending','verified')",
          str(paymentId, 80),
          account,
        );
        if (!p)
          fail("An included payment report changed. Review it again.", 409);
        s.push(
          guard(
            db,
            "EXISTS(SELECT 1 FROM payments WHERE id=? AND method=? AND status IN('pending','verified'))",
            paymentId,
            account,
          ),
          stmt(
            db,
            "INSERT INTO money_observation_coverage(observation_id,payment_id) VALUES(?,?)",
            id,
            paymentId,
          ),
        );
      }
    }
  } else if (b.action === "moneyTransfer") {
    const from = await accountGuard(db, b.from),
      to = await accountGuard(db, b.to);
    if (from.account === to.account)
      fail("Choose different transfer accounts.");
    const amount = int(b.amount, 1, 100000000),
      effective = effectiveTime(b.effectiveAt),
      reference = noteText(b.reference, 200, 1);
    s.push(
      from.statement,
      to.statement,
      movement(db, {
        id: op.id + ":out",
        account: from.account,
        amount: -amount,
        category: "transfer",
        sourceType: "transfer-out",
        sourceId: op.id,
        effective,
        actor: m.id,
        reference,
        transfer: op.id,
      }),
      movement(db, {
        id: op.id + ":in",
        account: to.account,
        amount,
        category: "transfer",
        sourceType: "transfer-in",
        sourceId: op.id,
        effective,
        actor: m.id,
        reference,
        transfer: op.id,
      }),
    );
  } else if (b.action === "moneyExpense" || b.action === "moneyAdjustment") {
    const a = await accountGuard(db, b.account),
      amount = int(
        b.amount,
        b.action === "moneyExpense" ? 1 : -100000000,
        100000000,
      ),
      reason = noteText(b.reason),
      effective = effectiveTime(b.effectiveAt),
      kind = b.action === "moneyAdjustment" ? "adjustment" : str(b.kind, 30);
    if (!["adjustment", "morale", "fee", "tax", "other"].includes(kind))
      fail("Choose an expense category.");
    s.push(a.statement);
    if (b.action === "moneyExpense")
      s.push(
        stmt(
          db,
          "INSERT INTO expenses(id,kind,amount,description,created_at) VALUES(?,?,?,?,?)",
          op.id,
          kind,
          amount,
          reason,
          effective,
        ),
      );
    s.push(
      movement(db, {
        id: op.id,
        account: a.account,
        amount: b.action === "moneyExpense" ? -amount : amount,
        category: kind,
        sourceType: b.action === "moneyExpense" ? "expense" : "adjustment",
        sourceId: op.id,
        effective,
        actor: m.id,
        reference: reason,
      }),
    );
  } else if (b.action === "moneySettle") {
    const receipt = str(b.receiptId, 80),
      r = await first(
        db,
        `SELECT r.*,COALESCE((SELECT SUM(amount) FROM reimbursement_settlements WHERE receipt_id=r.receipt_id),0) paid,COALESCE((SELECT SUM(c.refund) FROM purchase_corrections c JOIN purchase_lines l ON l.id=c.purchase_line_id WHERE l.receipt_id=r.receipt_id),0) returned FROM reimbursements r WHERE receipt_id=?`,
        receipt,
      );
    if (!r) fail("Choose an unpaid reimbursement.");
    const amount = int(b.amount, 1, r.amount - r.paid - r.returned),
      a = await accountGuard(db, b.account),
      reference = noteText(b.reference, 200, 1),
      effective = effectiveTime(b.effectiveAt);
    s.push(
      a.statement,
      guard(
        db,
        "(SELECT amount FROM reimbursements WHERE receipt_id=?)-COALESCE((SELECT SUM(amount) FROM reimbursement_settlements WHERE receipt_id=?),0)-COALESCE((SELECT SUM(c.refund) FROM purchase_corrections c JOIN purchase_lines l ON l.id=c.purchase_line_id WHERE l.receipt_id=?),0)>=?",
        receipt,
        receipt,
        receipt,
        amount,
      ),
      stmt(
        db,
        "INSERT INTO reimbursement_settlements(id,receipt_id,amount,account_id,actor,created_at,reference) VALUES(?,?,?,?,?,?,?)",
        op.id,
        receipt,
        amount,
        a.account,
        m.id,
        effective,
        reference,
      ),
      movement(db, {
        id: op.id,
        account: a.account,
        amount: -amount,
        category: "reimbursement",
        sourceType: "reimbursement",
        sourceId: op.id,
        effective,
        actor: m.id,
        reference,
      }),
    );
  } else if (b.action === "moneyCommitment") {
    const id = b.id ? str(b.id, 80) : op.id,
      old = await first(db, "SELECT * FROM money_commitments WHERE id=?", id),
      label = noteText(b.label, 150, 1),
      kind = str(b.kind, 30),
      group = noteText(b.groupKey, 100, 1),
      status = str(b.status || "open", 20),
      run = b.runId ? str(b.runId, 80) : null;
    if (
      !["prepaid", "tax", "refund", "supplier", "other"].includes(kind) ||
      !["open", "settled", "cancelled"].includes(status)
    )
      fail("Choose a commitment type and status.");
    if (
      run &&
      !old &&
      (await first(db, "SELECT id FROM purchase_receipts WHERE run_id=?", run))
    )
      fail("This run is already purchased; use its funding record.");
    s.push(
      guard(
        db,
        "COALESCE((SELECT version FROM money_commitments WHERE id=?),-1)=?",
        id,
        old ? int(b.version) : -1,
      ),
      stmt(
        db,
        `INSERT INTO money_commitments(id,label,amount,kind,group_key,run_id,status,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,amount=excluded.amount,kind=excluded.kind,group_key=excluded.group_key,run_id=excluded.run_id,status=excluded.status,version=money_commitments.version+1`,
        id,
        label,
        int(b.amount, 0, 100000000),
        kind,
        group,
        run,
        status,
        m.id,
        now,
      ),
    );
  } else if (b.action === "moneyAccount") {
    const id = b.id ? str(b.id, 80) : op.id,
      name = noteText(b.name, 80, 1),
      old = await first(db, "SELECT * FROM money_accounts WHERE id=?", id),
      kind = b.kind || old?.kind || "holding";
    if (!["holding", "investment"].includes(kind))
      fail("Choose a holding or investment account.");
    if (old && kind !== old.kind)
      fail("Create a separate account to change its type.");
    if (["cash", "cashapp"].includes(id) && b.active === false)
      fail(
        "Cash and Cash App remain available for existing payment workflows.",
      );
    s.push(
      guard(
        db,
        "COALESCE((SELECT version FROM money_accounts WHERE id=?),-1)=?",
        id,
        old ? int(b.version) : -1,
      ),
      stmt(
        db,
        "INSERT INTO money_accounts(id,name,active,kind) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active,version=money_accounts.version+1",
        id,
        name,
        b.active === false ? 0 : 1,
        kind,
      ),
    );
  } else if (b.action === "moneySelectRun") {
    const id = b.runId ? str(b.runId, 80) : null;
    if (
      id &&
      !(await first(
        db,
        "SELECT run_id FROM workflow_runs WHERE run_id=? AND stage IN('planning','shopping','purchased')",
        id,
      ))
    )
      fail("Choose an open plan.");
    s.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM workflow_settings WHERE id='main' AND version=?)",
        int(b.version),
      ),
      stmt(
        db,
        "UPDATE workflow_settings SET selected_run=?,price_fresh_days=?,version=version+1 WHERE id='main'",
        id,
        int(b.freshDays ?? 30, 1, 365),
      ),
    );
  } else fail("Choose a supported money action.");
  s.push(
    audit(db, m.id, b.action, op.id, {
      accounts: b.accounts?.length,
      account: b.account || null,
    }),
  );
  await op.commit(s);
  return { ok: true, id: op.id };
}
