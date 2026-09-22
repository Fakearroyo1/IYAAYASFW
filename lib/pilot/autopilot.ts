import {moneySummary} from './money';
import {
  type DB,
  type Row,
  fail,
  str,
  int,
  first,
  rows,
  stmt,
  guard,
  audit,
  uid,
  hash,
} from "./core";
import { operation, noteText } from "./operation";
export const INVENTORY_ACTIONS = [
  "inventoryPlan",
  "restockCreate",
  "restockEdit",
  "restockReceive",
  "restockCancel",
  "countCreate",
  "countComplete",
  "countCancel",
  "monthClose",
  "monthReopen",
];
export const MONTH_CHECKS = [
  "payments",
  "balances",
  "counts",
  "shrink",
  "cash",
  "cashapp",
  "adjustments",
];
export function recommendation(p: Row): Row {
  const velocity = p.units / 30,
    target =
      Math.ceil(velocity * (p.lead_days + p.target_days)) + p.safety_units,
    netPrice = p.price / (1 + (p.tax_bp || 0) / 10000);
  return {
    ...p,
    dailyVelocity: velocity,
    daysLeft: velocity > 0 ? p.available / velocity : null,
    stockoutAt:
      velocity > 0 ? Date.now() + (p.available / velocity) * 86400000 : null,
    suggested: Math.max(
      0,
      Math.ceil((target - p.available) / p.pack_size) * p.pack_size,
    ),
    target,
    margin:
      netPrice > 0 && p.cost != null ? (netPrice - p.cost) / netPrice : null,
    shrinkRate:
      p.units + p.waste_units > 0
        ? p.waste_units / (p.units + p.waste_units)
        : null,
    signal:
      p.waste_units > p.units / 4 && p.waste_units > 0
        ? "Review waste"
        : p.rating != null && p.rating < 3
          ? "Review feedback"
          : velocity > 0 && p.available < velocity * p.lead_days
            ? "Restock soon"
            : velocity === 0
              ? "Review demand"
              : "Maintain",
  };
}
export function countPriority(p: Row, now = Date.now()) {
  const days = p.last_count
    ? Math.min(90, Math.max(0, (now - p.last_count) / 86400000))
    : 90;
  return (
    (p.units + p.waste_units * 5 + Math.max(1, p.available)) *
    (p.cost || 1) *
    (1 + days / 7)
  );
}
export async function inventoryRows(db: DB) {
  const result = await rows(
    db,
    `SELECT p.id product_id,COALESCE(v.id,'') option_id,p.name,p.category,COALESCE(v.label,'Standard') option_label,p.version product_version,COALESCE(v.version,0) option_version,
 CASE WHEN v.id IS NULL THEN p.stock ELSE v.stock END available,COALESCE(v.price,p.price) price,COALESCE(v.cost,p.cost) cost,p.tax_bp,
 COALESCE(ip.vendor,'') vendor,COALESCE(ip.pack_size,1) pack_size,COALESCE(ip.lead_days,7) lead_days,COALESCE(ip.target_days,21) target_days,COALESCE(ip.safety_units,2) safety_units,COALESCE(ip.version,-1) plan_version,
 COALESCE((SELECT SUM(i.remaining_qty) FROM item_balances i JOIN orders o ON o.id=i.order_id WHERE i.product_id=p.id AND COALESCE(i.variant_id,'')=COALESCE(v.id,'') AND o.status IN('paid','tab') AND o.created_at>?),0) units,
 (SELECT COUNT(*) FROM (SELECT o.member_id FROM item_balances i JOIN orders o ON o.id=i.order_id WHERE i.product_id=p.id AND COALESCE(i.variant_id,'')=COALESCE(v.id,'') AND o.member_id IS NOT NULL AND i.remaining_qty>0 AND o.status IN('paid','tab') AND o.created_at>? GROUP BY o.member_id HAVING COUNT(DISTINCT o.id)>=2)) buyers,
 (SELECT ROUND(AVG(rating),1) FROM product_reviews WHERE product_id=p.id AND removed=0) rating,
 COALESCE((SELECT SUM(-c.variance) FROM inventory_counts c JOIN count_sessions s ON s.id=c.session_id WHERE c.product_id=p.id AND c.option_id=COALESCE(v.id,'') AND s.status='completed' AND s.completed_at>? AND c.variance<0),0) waste_units,
 (SELECT MAX(s.completed_at) FROM inventory_counts c JOIN count_sessions s ON s.id=c.session_id WHERE c.product_id=p.id AND c.option_id=COALESCE(v.id,'') AND s.status='completed') last_count
 FROM products p LEFT JOIN product_variants v ON v.product_id=p.id LEFT JOIN product_details d ON d.product_id=p.id LEFT JOIN inventory_plans ip ON ip.product_id=p.id AND ip.option_id=COALESCE(v.id,'')
 WHERE p.active=1 AND COALESCE(d.archived,0)=0 AND COALESCE(v.active,1)=1 AND CASE WHEN v.id IS NULL THEN p.preorder ELSE v.preorder END=0 ORDER BY ip.vendor,p.category,p.name,v.label LIMIT 400`,
    Date.now() - 30 * 86400000,
    Date.now() - 30 * 86400000,
    Date.now() - 30 * 86400000,
  );
  const shrink = await rows(
    db,
    `SELECT c.product_id,c.option_id,c.kind,COUNT(*) counts,SUM(CASE WHEN c.variance<0 THEN -c.variance ELSE 0 END) lost_units,SUM(CASE WHEN c.variance>0 THEN c.variance ELSE 0 END) found_units,SUM(CASE WHEN c.variance<0 THEN -c.variance*COALESCE(c.cost,0) ELSE 0 END) known_loss_cost,SUM(CASE WHEN c.variance<0 AND c.cost IS NULL THEN 1 ELSE 0 END) unknown_cost_lines FROM inventory_counts c JOIN count_sessions s ON s.id=c.session_id WHERE s.status='completed' AND s.completed_at>? AND c.variance<>0 GROUP BY c.product_id,c.option_id,c.kind`,
    Date.now() - 30 * 86400000,
  );
  return result.map<Row>((p) => ({
    ...recommendation(p),
    shrink: shrink.filter(
      (s) => s.product_id === p.product_id && s.option_id === p.option_id,
    ),
  }));
}
export function monthWindow(value: unknown) {
  const month = str(value, 7);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) fail("Choose a valid month.");
  const start = Date.parse(month + "-01T00:00:00Z"),
    d = new Date(start);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { month, start, end: d.getTime() };
}
export async function monthReport(db: DB, value: unknown) {
  const { month, start, end } = monthWindow(value);
  const revision = (await first(
    db,
    "SELECT version FROM accounting_revision WHERE id='main'",
  ))!.version;
  const sales = await first(
    db,
    `SELECT COUNT(*) orders,COALESCE(SUM(total),0) total,COALESCE(SUM(tax),0) tax,COALESCE(SUM(cost),0) known_cost,SUM(CASE WHEN cost IS NULL THEN 1 ELSE 0 END) unknown_cost_orders FROM order_balances WHERE created_at>=? AND created_at<? AND status IN('paid','tab')`,
    start,
    end,
  );
  const payments = await rows(
    db,
    "SELECT method,status,COUNT(*) count,SUM(amount) amount FROM payment_balances WHERE created_at>=? AND created_at<? GROUP BY method,status",
    start,
    end,
  );
  const expenses = await rows(
    db,
    "SELECT kind,SUM(amount) amount FROM expenses WHERE created_at>=? AND created_at<? GROUP BY kind",
    start,
    end,
  );
  const counts = await first(
    db,
    `SELECT COUNT(*) lines,COALESCE(SUM(CASE WHEN c.variance<0 THEN -c.variance ELSE 0 END),0) lost_units,COALESCE(SUM(CASE WHEN c.variance<0 THEN -c.variance*c.cost ELSE 0 END),0) known_loss_cost,SUM(CASE WHEN c.variance<0 AND c.cost IS NULL THEN 1 ELSE 0 END) unknown_loss_cost FROM inventory_counts c JOIN count_sessions s ON s.id=c.session_id WHERE s.status='completed' AND s.completed_at>=? AND s.completed_at<?`,
    start,
    end,
  );
  const adjustments = await first(
    db,
    "SELECT COUNT(*) count,COALESCE(SUM(total),0) total,COALESCE(SUM(external_refund),0) refunds,COALESCE(SUM(credit_returned),0) credits FROM transaction_adjustments WHERE created_at>=? AND created_at<?",
    start,
    end,
  );
  const balances = await first(
    db,
    "SELECT COALESCE(SUM(debt),0) debt,COALESCE(SUM(credit),0) credit,COUNT(*) members FROM members WHERE debt>0 OR credit>0",
  );
  const pending = await first(
    db,
    "SELECT COUNT(*) count FROM payments WHERE status='pending' AND created_at>=? AND created_at<?",
    start,
    end,
  );
  const period = await first(
      db,
      "SELECT * FROM accounting_periods WHERE month=?",
      month,
    ),
    snapshots = await rows(
      db,
      "SELECT id,actor,created_at,note FROM accounting_snapshots WHERE month=? ORDER BY created_at DESC",
      month,
    );
  const costCoverage=await first(db,`SELECT COALESCE(SUM(i.remaining_qty),0) units,COALESCE(SUM(CASE WHEN COALESCE(i.cost,c.unit_cost) IS NULL THEN i.remaining_qty ELSE 0 END),0) unknown_units,COALESCE(SUM(COALESCE(i.cost,c.unit_cost,0)*i.remaining_qty),0) known_cost,COALESCE(SUM(CASE WHEN COALESCE(i.cost,c.unit_cost) IS NOT NULL THEN i.price*i.remaining_qty-i.remaining_tax-COALESCE(i.cost,c.unit_cost)*i.remaining_qty ELSE 0 END),0) known_margin FROM item_balances i JOIN orders o ON o.id=i.order_id LEFT JOIN sale_cost_corrections c ON c.item_id=i.id WHERE o.created_at>=? AND o.created_at<? AND o.status IN('paid','tab') AND i.custom=0`,start,end);
  const money=await moneySummary(db);
  if (
    (await first(
      db,
      "SELECT version FROM accounting_revision WHERE id='main'",
    ))!.version !== revision
  )
    fail("Records changed during report preparation. Refresh the report.", 409);
  return {
    month,
    start,
    end,
    revision,
    sales,
    costCoverage,
    money,
    payments,
    expenses,
    counts,
    adjustments,
    balances,
    pending: pending?.count || 0,
    period: period || { month, status: "open", version: -1 },
    snapshots,
    reportBasis:
      "UTC month; sales are net of recorded corrections. Outstanding balances are a current snapshot, not historical cash flow.",
  };
}
export async function autopilotPage(db: DB, q: Row) {
  if (q.kind === "month") {
    const report = await monthReport(db, q.month);
    return {
      ...report,
      closedSnapshot: report.period.current_snapshot
        ? await first(
            db,
            "SELECT * FROM accounting_snapshots WHERE id=?",
            report.period.current_snapshot,
          )
        : null,
      events: await rows(
        db,
        "SELECT * FROM accounting_events WHERE month=? ORDER BY created_at DESC LIMIT 50",
        q.month,
      ),
    };
  }
  return {
    items: await inventoryRows(db),
    runs: await rows(
      db,
      "SELECT * FROM restock_runs ORDER BY created_at DESC LIMIT 30",
    ),
    runItems: await rows(
      db,
      "SELECT ri.*,p.name FROM restock_run_items ri JOIN products p ON p.id=ri.product_id WHERE run_id IN(SELECT id FROM restock_runs ORDER BY created_at DESC LIMIT 30)",
    ),
    sessions: await rows(
      db,
      "SELECT * FROM count_sessions ORDER BY created_at DESC LIMIT 20",
    ),
    counts: await rows(
      db,
      "SELECT c.*,p.name FROM inventory_counts c JOIN products p ON p.id=c.product_id WHERE c.session_id IN(SELECT id FROM count_sessions ORDER BY created_at DESC LIMIT 20)",
    ),
    requests: await rows(
      db,
      "SELECT r.title,r.status,COALESCE(SUM(v.value),0) votes FROM item_requests r LEFT JOIN request_votes v ON v.request_id=r.id WHERE r.removed=0 GROUP BY r.id ORDER BY votes DESC LIMIT 8",
    ),
  };
}
export async function mutateInventory(
  db: DB,
  m: Row,
  b: Row,
  tokenHash?: string,
) {
  const op = await operation(db, m, b, true, tokenHash);
  if (op.replayed) return { ok: true, replayed: true };
  const now = Date.now();
  let statements: D1PreparedStatement[] = [],
    result: Row = { ok: true };
  if (b.action === "inventoryPlan") {
    const p = str(b.productId, 80),
      v = str(b.optionId || "", 80);
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM products p WHERE p.id=? AND (?='' OR EXISTS(SELECT 1 FROM product_variants v WHERE v.id=? AND v.product_id=p.id)))",
        p,
        v,
        v,
      ),
      guard(
        db,
        "COALESCE((SELECT version FROM inventory_plans WHERE product_id=? AND option_id=?),-1)=?",
        p,
        v,
        int(b.version, -1),
      ),
      stmt(
        db,
        `INSERT INTO inventory_plans(product_id,option_id,vendor,pack_size,lead_days,target_days,safety_units) VALUES(?,?,?,?,?,?,?) ON CONFLICT(product_id,option_id) DO UPDATE SET vendor=excluded.vendor,pack_size=excluded.pack_size,lead_days=excluded.lead_days,target_days=excluded.target_days,safety_units=excluded.safety_units,version=inventory_plans.version+1`,
        p,
        v,
        str(b.vendor || "", 100),
        int(b.packSize, 1, 1000),
        int(b.leadDays, 0, 90),
        int(b.targetDays, 1, 180),
        int(b.safetyUnits, 0, 10000),
      ),
      audit(db, m.id, "inventory_plan", p, {
        optionId: v,
        reason: noteText(b.reason || "", 1000, 0),
      }),
    ];
  } else if (b.action === "restockCreate") {
    const id = op.id,
      inventory = await inventoryRows(db);
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 20)
      fail("Choose 1–20 items for a run.");
    const seen = new Set<string>();
    statements.push(
      stmt(
        db,
        "INSERT INTO restock_runs(id,name,actor,created_at) VALUES(?,?,?,?)",
        id,
        noteText(b.name, 100, 2),
        m.id,
        now,
      ),
    );
    for (const x of b.items) {
      const key = str(x.productId, 80) + ":" + str(x.optionId || "", 80),
        p = inventory.find((i) => i.product_id + ":" + i.option_id === key);
      if (!p || seen.has(key)) fail("Choose each current stocked option once.");
      seen.add(key);
      const qty = int(x.qty, 1, 10000),
        reason = qty !== p.suggested ? noteText(x.reason) : "";
      statements.push(
        stmt(
          db,
          "INSERT INTO restock_run_items(id,run_id,product_id,option_id,suggested_qty,qty,vendor,override_reason) VALUES(?,?,?,?,?,?,?,?)",
          uid(),
          id,
          p.product_id,
          p.option_id,
          p.suggested,
          qty,
          p.vendor,
          reason,
        ),
      );
    }
    statements.push(
      audit(db, m.id, "restock_run_created", id, { items: b.items.length }),
    );
    result.id = id;
  } else if (
    ["restockEdit", "restockReceive", "restockCancel"].includes(b.action)
  ) {
    const id = str(b.id, 80),
      run = await first(
        db,
        "SELECT * FROM restock_runs WHERE id=? AND status='shopping'",
        id,
      );
    if (!run) fail("This restock run is no longer open.");
    if(await first(db,"SELECT run_id FROM workflow_runs WHERE run_id=?",id))fail("Use the current Restock screen for this run.",409);
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM restock_runs WHERE id=? AND version=? AND status='shopping')",
        id,
        int(b.version),
      ),
    );
    if (b.action === "restockCancel") {
      statements.push(
        stmt(
          db,
          "UPDATE restock_runs SET status='cancelled',version=version+1 WHERE id=?",
          id,
        ),
      );
    } else if (b.action === "restockEdit") {
      const item = await first(
        db,
        "SELECT * FROM restock_run_items WHERE id=? AND run_id=?",
        str(b.itemId, 80),
        id,
      );
      if (!item) fail("Item not found.");
      const qty = int(b.qty, 0, 10000),
        reason = qty !== item.suggested_qty ? noteText(b.reason) : "";
      statements.push(
        stmt(
          db,
          "UPDATE restock_run_items SET qty=?,total_cost=?,checked=?,override_reason=? WHERE id=?",
          qty,
          b.totalCost == null ? null : int(b.totalCost, 0, 10000000),
          b.checked ? 1 : 0,
          reason,
          item.id,
        ),
        stmt(db, "UPDATE restock_runs SET version=version+1 WHERE id=?", id),
      );
    } else {
      const list = await rows(
          db,
          "SELECT * FROM restock_run_items WHERE run_id=?",
          id,
        ),
        inventory = await inventoryRows(db),
        receipt = str(b.receipt || "", 160);
      if (!list.every((x) => x.checked))
        fail(
          "Check every item before receiving. Mark unavailable items with quantity zero.",
        );
      const selected = list.filter((x) => x.qty > 0);
      if (!selected.length)
        fail("There is no stock to receive. Cancel this run instead.");
      for (const item of selected) {
        const p = inventory.find(
          (p) =>
            p.product_id === item.product_id && p.option_id === item.option_id,
        );
        if (!p || item.total_cost == null)
          fail("Enter actual costs for all received items.");
        const cost =
          p.available > 0 && p.cost == null
            ? null
            : Math.round(
                ((p.cost || 0) * p.available + item.total_cost) /
                  (p.available + item.qty),
              );
        statements.push(
          guard(
            db,
            `EXISTS(SELECT 1 FROM ${p.option_id ? "product_variants" : "products"} WHERE id=? AND stock=? AND version=?)`,
            p.option_id || p.product_id,
            p.available,
            p.option_id ? p.option_version : p.product_version,
          ),
          stmt(
            db,
            `UPDATE ${p.option_id ? "product_variants" : "products"} SET stock=stock+?,cost=?,version=version+1 WHERE id=?`,
            item.qty,
            cost,
            p.option_id || p.product_id,
          ),
          stmt(
            db,
            "INSERT INTO restock_entries(id,product_id,variant_id,qty,total_cost,reference,created_at,actor) VALUES(?,?,?,?,?,?,?,?)",
            uid(),
            p.product_id,
            p.option_id || null,
            item.qty,
            item.total_cost,
            receipt,
            now,
            m.id,
          ),
        );
      }
      statements.push(
        stmt(
          db,
          "INSERT INTO expenses(id,kind,amount,description,created_at) VALUES(?,'stock',?,?,?)",
          id,
          selected.reduce((n, x) => n + x.total_cost, 0),
          "Restock run: " + run.name + (receipt ? " · " + receipt : ""),
          now,
        ),
        stmt(
          db,
          "UPDATE restock_runs SET status='received',receipt=?,received_at=?,version=version+1 WHERE id=?",
          receipt,
          now,
          id,
        ),
      );
    }
    statements.push(
      audit(db, m.id, b.action, id, {
        reason:
          b.action === "restockCancel"
            ? noteText(b.reason)
            : "Restock workflow updated.",
      }),
    );
  } else if (b.action === "countCreate") {
    const inventory = await inventoryRows(db),
      selected = [...inventory]
        .sort((a, b) => countPriority(b, now) - countPriority(a, now))
        .slice(0, int(b.size || 5, 3, 5));
    if (!selected.length) fail("No stocked items are available to count.");
    statements.push(
      stmt(
        db,
        "INSERT INTO count_sessions(id,actor,created_at) VALUES(?,?,?)",
        op.id,
        m.id,
        now,
      ),
    );
    for (const p of selected)
      statements.push(
        stmt(
          db,
          "INSERT INTO inventory_counts(id,session_id,product_id,option_id,expected,product_version,option_version,cost) VALUES(?,?,?,?,?,?,?,?)",
          uid(),
          op.id,
          p.product_id,
          p.option_id,
          p.available,
          p.product_version,
          p.option_version,
          p.cost,
        ),
      );
    statements.push(
      audit(db, m.id, "count_started", op.id, { size: selected.length }),
    );
    result.id = op.id;
  } else if (b.action === "countComplete" || b.action === "countCancel") {
    const id = str(b.id, 80),
      items = await rows(
        db,
        "SELECT * FROM inventory_counts WHERE session_id=?",
        id,
      );
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM count_sessions WHERE id=? AND status='open' AND version=?)",
        id,
        int(b.version),
      ),
    );
    if (b.action === "countComplete") {
      if (
        !Array.isArray(b.items) ||
        b.items.length !== items.length ||
        new Set(b.items.map((x: Row) => x.id)).size !== items.length
      )
        fail("Complete each count once.");
      for (const c of items) {
        const input = b.items.find((x: Row) => x.id === c.id);
        if (!input) fail("Complete every count.");
        const actual = int(input.actual, 0, 100000),
          variance = actual - c.expected,
          kind = variance === 0 ? "matched" : str(input.kind, 20),
          reason =
            variance === 0 ? "Physical count matched." : noteText(input.reason);
        if (
          !["matched", "explained", "unexplained", "waste", "damage"].includes(
            kind,
          ) ||
          (variance !== 0 && kind === "matched")
        )
          fail("Categorize each variance.");
        statements.push(
          guard(
            db,
            `EXISTS(SELECT 1 FROM ${c.option_id ? "product_variants" : "products"} WHERE id=? AND stock=? AND version=?)`,
            c.option_id || c.product_id,
            c.expected,
            c.option_id ? c.option_version : c.product_version,
          ),
          stmt(
            db,
            "UPDATE inventory_counts SET actual=?,variance=?,kind=?,reason=? WHERE id=?",
            actual,
            variance,
            kind,
            reason,
            c.id,
          ),
        );
        if (variance)
          statements.push(
            stmt(
              db,
              `UPDATE ${c.option_id ? "product_variants" : "products"} SET stock=?,version=version+1 WHERE id=?`,
              actual,
              c.option_id || c.product_id,
            ),
          );
      }
    }
    statements.push(
      stmt(
        db,
        "UPDATE count_sessions SET status=?,completed_at=?,version=version+1 WHERE id=?",
        b.action === "countComplete" ? "completed" : "cancelled",
        now,
        id,
      ),
      audit(db, m.id, b.action, id, {
        reason:
          b.action === "countCancel"
            ? noteText(b.reason)
            : "Physical counts recorded with categorized variances.",
      }),
    );
  } else if (b.action === "monthClose" || b.action === "monthReopen") {
    const report = await monthReport(db, b.month),
      reason = b.action === "monthReopen" ? noteText(b.reason) : noteText(b.reason || "Completed reconciliation checkpoints.", 1000, 0),
      version = int(b.version, -1);
    statements.push(
      guard(
        db,
        "COALESCE((SELECT version FROM accounting_periods WHERE month=?),-1)=?",
        report.month,
        version,
      ),
    );
    if (b.action === "monthClose") {
      if (report.end > now) fail("Close a completed calendar month.");
      if (report.period.status === "closed")
        fail("This month is already closed.");
      if (report.pending) fail("Resolve this month’s pending payments first.");
      if (!MONTH_CHECKS.every((k) => b.checklist?.[k] === true))
        fail("Complete every reconciliation checkpoint.");
      // Check the same data inside the transaction; no snapshot can race a correction.
      if (b.revision !== report.revision)
        fail("The report changed. Refresh and review it before closing.", 409);
      statements.push(
        guard(
          db,
          "(SELECT COUNT(*) FROM payments WHERE status='pending' AND created_at>=? AND created_at<?)=0",
          report.start,
          report.end,
        ),
        guard(
          db,
          "EXISTS(SELECT 1 FROM accounting_revision WHERE id='main' AND version=?)",
          report.revision,
        ),
        stmt(
          db,
          "INSERT INTO accounting_periods(month,status,current_snapshot) VALUES(?,'closed',?) ON CONFLICT(month) DO UPDATE SET status='closed',current_snapshot=excluded.current_snapshot,version=accounting_periods.version+1",
          report.month,
          op.id,
        ),
        stmt(
          db,
          "INSERT INTO accounting_snapshots(id,month,actor,created_at,report,checklist,note,cash_on_hand,cashapp_reference) VALUES(?,?,?,?,?,?,?,?,?)",
          op.id,
          report.month,
          m.id,
          now,
          JSON.stringify(report),
          JSON.stringify(b.checklist),
          reason,
          report.money.accounts.find(a=>a.id==='cash')?.checked_amount??int(b.cashOnHand, 0, 100000000),
          noteText(b.cashappReference, 200),
        ),
      );
      statements.push(stmt(db,"INSERT INTO accounting_money_snapshots(snapshot_id,report) VALUES(?,?)",op.id,JSON.stringify(report.money)));
    } else {
      if (report.period.status !== "closed")
        fail("This month is already open.");
      statements.push(
        stmt(
          db,
          "UPDATE accounting_periods SET status='open',version=version+1 WHERE month=?",
          report.month,
        ),
      );
    }
    statements.push(
      stmt(
        db,
        "INSERT INTO accounting_events(id,month,kind,actor,reason,created_at) VALUES(?,?,?,?,?,?)",
        uid(),
        report.month,
        b.action,
        m.id,
        reason,
        now,
      ),
      audit(db, m.id, b.action, report.month, {
        reason,
        snapshot:
          b.action === "monthClose" ? op.id : report.period.current_snapshot,
      }),
    );
  } else fail("Choose a supported inventory action.");
  await op.commit(statements);
  return result;
}
