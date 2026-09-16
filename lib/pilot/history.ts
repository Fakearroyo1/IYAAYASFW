import { first, rows, fail, type DB, type Row, ownerAccount } from "./core";
export type HistoryOptions = {
  cursor?: string;
  limit?: number;
  from?: string;
  to?: string;
  search?: string;
  filter?: string;
  productId?: string;
  admin?: boolean;
  until?: number;
};
export function dateRange(from = "", to = "") {
  const parse = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail("Choose a valid date.");
    const n = Date.parse(s + "T00:00:00Z");
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== s)
      fail("Choose a valid date.");
    return n;
  };
  const start = from ? parse(from) : 0,
    end = to ? parse(to) + 86400000 : 8640000000000000;
  if (start >= end) fail("The end date must be on or after the start date.");
  return { start, end };
}
export function cursorValue(value?: string) {
  if (!value) return null;
  if (value.length > 500) fail("Invalid page cursor.");
  try {
    const v = JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/")));
    if (
      !Number.isSafeInteger(v.t) ||
      v.t < 0 ||
      typeof v.id !== "string" ||
      v.id.length > 100
    )
      throw Error();
    return v as { t: number; id: string };
  } catch {
    fail("Invalid page cursor.");
  }
}
export const cursorFor = (r: Row) =>
  btoa(JSON.stringify({ t: r.created_at, id: r.id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export const ITEM_SQL = "SELECT i.* FROM item_balances i";
export const MEMBER_SQL =
  "SELECT m.*,COALESCE(c.tab_limit,3000) tab_limit,COALESCE(c.posting_enabled,1) posting_enabled,COALESCE(c.version,0) controls_version,COALESCE(a.snacks,1) snacks,COALESCE(a.gear,1) gear,EXISTS(SELECT 1 FROM auth_credentials c WHERE c.member_id=m.id) password_set,s.expires_at setup_expires_at,0 created_at FROM members m LEFT JOIN member_controls c ON c.member_id=m.id LEFT JOIN member_access a ON a.member_id=m.id LEFT JOIN auth_setup s ON s.member_id=m.id";
export async function historyPage(
  db: DB,
  m: Row,
  kind: string,
  options: HistoryOptions = {},
) {
  const admin = options.admin === true;
  if (admin && m.role !== "admin")
    fail("Administrator access is required.", 403);
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail("Choose a page size between 1 and 100.");
  const cursor = cursorValue(options.cursor),
    { start, end } = dateRange(options.from, options.to),
    where: string[] = [],
    values: any[] = [];
  let sql = "",
    time = "",
    key = "";
  if (kind === "orders") {
    sql = "SELECT o.* FROM order_balances o";
    time = "o.created_at";
    key = "o.id";
    if (!admin) {
      where.push("o.member_id=?");
      values.push(m.id);
    }
  } else if (kind === "payments") {
    sql =
      "SELECT p.*,m.name member_name,o.code order_code,o.payer FROM payment_balances p LEFT JOIN members m ON m.id=p.member_id LEFT JOIN orders o ON o.id=p.order_id";
    time = "p.created_at";
    key = "p.id";
    if (!admin) {
      where.push("p.member_id=?");
      values.push(m.id);
    }
    if (options.filter && options.filter !== "all") {
      if (!["pending", "verified", "rejected"].includes(options.filter))
        fail("Invalid payment filter.");
      where.push("p.status=?");
      values.push(options.filter);
    }
  } else if (kind === "pickups" || kind === "items") {
    sql =
      "SELECT i.*,o.created_at,o.code order_code,o.payer,o.status order_status FROM item_balances i JOIN order_balances o ON o.id=i.order_id";
    time = "o.created_at";
    key = "i.id";
    if (kind === "pickups") {
      where.push(
        "o.status<>'void' AND i.remaining_qty>0 AND (i.category='Gear' OR i.fulfillment IS NOT NULL) AND i.custom=0",
      );
      const filter = options.filter || "open";
      if (filter === "open")
        where.push("COALESCE(i.fulfillment,'untracked')<>'fulfilled'");
      else if (filter !== "all") {
        if (
          !["awaiting_stock", "ready", "fulfilled", "untracked"].includes(
            filter,
          )
        )
          fail("Invalid pickup filter.");
        where.push("COALESCE(i.fulfillment,'untracked')=?");
        values.push(filter);
      }
    }
    if (!admin) {
      where.push("o.member_id=?");
      values.push(m.id);
    }
  } else if (kind === "corrections") {
    if (!admin) fail("Administrator access is required.", 403);
    sql =
      "SELECT a.*,o.code order_code,o.payer,m.name actor_name FROM transaction_adjustments a JOIN orders o ON o.id=a.order_id LEFT JOIN members m ON m.id=a.actor";
    time = "a.created_at";
    key = "a.id";
  } else if (kind === "ledger") {
    sql =
      "SELECT l.*,m.name actor_name FROM balance_ledger l LEFT JOIN members m ON m.id=l.actor";
    time = "l.created_at";
    key = "l.id";
    if (!admin) {
      where.push("l.member_id=?");
      values.push(m.id);
    }
  } else if (kind === "resets") {
    if (!admin) fail("Administrator access is required.", 403);
    sql =
      "SELECT r.*,m.name,m.email,m.role,m.active,EXISTS(SELECT 1 FROM auth_credentials c WHERE c.member_id=m.id) password_set FROM password_reset_requests r JOIN members m ON m.id=r.member_id";
    time = "r.created_at";
    key = "r.id";
    where.push("r.status='pending'");
  } else if (kind === "events") {
    if (!admin) fail("Administrator access is required.", 403);
    sql =
      "SELECT e.*,m.name actor_name FROM audit e LEFT JOIN members m ON m.id=e.actor";
    time = "e.created_at";
    key = "e.id";
    if (options.productId) {
      where.push(
        "e.target=? AND e.kind IN('stock_received','price_updated','product_updated')",
      );
      values.push(options.productId);
    }
  } else if (kind === "expenses") {
    if (!admin) fail("Administrator access is required.", 403);
    sql = "SELECT e.* FROM expenses e";
    time = "e.created_at";
    key = "e.id";
  } else if (kind === "members") {
    if (!admin) fail("Administrator access is required.", 403);
    sql = MEMBER_SQL;
    time = "0";
    key = "m.id";
    const search = options.search || "";
    if (search.length > 100) fail("Search is too long.");
    if (search) {
      where.push("(m.name LIKE ? ESCAPE '\\' OR m.email LIKE ? ESCAPE '\\')");
      const term = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
      values.push(term, term);
    }
    const filters: Row = {
      all: "1",
      active: "m.active=1",
      inactive: "m.active=0",
      invited: "m.active=1 AND m.user_id IS NULL",
      owing: "m.debt>0",
      credit: "m.credit>0",
      admins: "m.role='admin'",
      password:
        "NOT EXISTS(SELECT 1 FROM auth_credentials c WHERE c.member_id=m.id)",
      gearOnly: "COALESCE(a.snacks,1)=0 AND COALESCE(a.gear,1)=1",
      overdue: "m.debt>0 AND m.due_since IS NOT NULL AND m.due_since<=?",
    };
    const filter = options.filter || "all";
    if (!Object.hasOwn(filters, filter)) fail("Invalid member filter.");
    where.push(filters[filter]);
    if (filter === "overdue")
      values.push(
        Date.now() -
          (await first(
            db,
            "SELECT reminder_days FROM settings WHERE id='main'",
          ))!.reminder_days *
            86400000,
      );
  } else fail("Choose a supported record type.");
  if (kind === "orders" && admin) {
    if (options.filter === "guest") where.push("o.member_id IS NULL");
    else if (options.filter === "unsettled")
      where.push("o.member_id IS NULL AND o.status='pending'");
    else if (options.filter === "void") where.push("o.status='void'");
    else if (options.filter === "corrected") where.push("o.adjusted_total>0");
    else if (options.filter && options.filter !== "all")
      fail("Invalid transaction filter.");
    const search = options.search || "";
    if (search.length > 100) fail("Search is too long.");
    if (search) {
      where.push(
        "(instr(lower(o.code),lower(?))>0 OR instr(lower(o.payer),lower(?))>0)",
      );
      values.push(search, search);
    }
  }

  if (kind !== "members") {
    where.push(`${time}>=? AND ${time}<?`);
    values.push(start, Math.min(end, options.until ?? end));
  }
  if (cursor) {
    where.push(`(${time}<? OR (${time}=? AND ${key}<?))`);
    values.push(cursor.t, cursor.t, cursor.id);
  }
  const found = await rows(
    db,
    sql +
      " WHERE " +
      (where.length ? where.join(" AND ") : "1") +
      ` ORDER BY ${kind === "members" ? "m.id DESC" : time + " DESC," + key + " DESC"} LIMIT ?`,
    ...values,
    limit + 1,
  );
  const hasMore = found.length > limit,
    records = found.slice(0, limit);
  const nextCursor = hasMore ? cursorFor(records[records.length - 1]) : null;
  return {
    records: records.map((r) => {
      if (kind === "members") return { ...r, isOwner: ownerAccount(r) };
      if (!admin) {
        const { cost, original_cost, fingerprint, ...publicRow } = r;
        return publicRow;
      }
      return r;
    }),
    nextCursor,
  };
}
export async function itemsForOrders(db: DB, orders: Row[], admin = false) {
  if (!orders.length) return [];
  const items = await rows(
    db,
    ITEM_SQL + ` WHERE i.order_id IN(${orders.map(() => "?").join(",")})`,
    ...orders.map((o) => o.id),
  );
  return admin ? items : items.map(({ cost, ...i }) => i);
}
export async function adminSummary(db: DB) {
  const [sales, payments, members, expenses, sold] = await Promise.all([
    first(
      db,
      "SELECT COALESCE(SUM(total),0) sales,COALESCE(SUM(tax),0) tax,CASE WHEN SUM(cost IS NULL)>0 THEN NULL ELSE COALESCE(SUM(cost),0) END costs FROM order_balances WHERE status<>'void'",
    ),
    first(
      db,
      "SELECT COALESCE(SUM(CASE WHEN status='verified' AND method IN('cash','cashapp') THEN CASE WHEN purpose='refund' THEN -amount ELSE amount END ELSE 0 END),0) received,COALESCE(SUM(status='pending'),0) pending FROM payment_balances",
    ),
    first(
      db,
      "SELECT COALESCE(SUM(debt),0) owed,COALESCE(SUM(credit),0) credits,COUNT(*) memberCount FROM members",
    ),
    first(
      db,
      "SELECT COALESCE(SUM(amount),0) morale FROM expenses WHERE kind='morale'",
    ),
    rows(
      db,
      "SELECT i.name,SUM(i.remaining_qty) qty FROM item_balances i JOIN order_balances o ON o.id=i.order_id WHERE o.status<>'void' AND i.remaining_qty>0 GROUP BY i.name ORDER BY qty DESC,i.name LIMIT 6",
    ),
  ]);
  const guests = await first(
    db,
    "SELECT COALESCE(SUM(cash_due-pending_reduced),0) guestOwed FROM order_balances WHERE member_id IS NULL AND status='pending'",
  );
  return { ...sales, ...payments, ...members, ...expenses, ...guests, sold };
}
export async function productPerformance(
  db: DB,
  id: string,
  options: HistoryOptions = {},
) {
  if (!id || id.length > 80) fail("Choose a product.");
  const { start, end } = dateRange(options.from, options.to);
  const stats = await first(
    db,
    "SELECT COALESCE(SUM(i.remaining_qty),0) units,COALESCE(SUM(i.price*i.remaining_qty),0) sales,COALESCE(SUM(i.remaining_tax),0) tax,COALESCE(SUM(CASE WHEN i.cost IS NULL THEN i.remaining_qty ELSE 0 END),0) unknownUnits,COALESCE(SUM(CASE WHEN i.cost IS NOT NULL THEN i.cost*i.remaining_qty ELSE 0 END),0) knownCost,COALESCE(SUM(CASE WHEN o.status='paid' THEN i.price*i.remaining_qty ELSE 0 END),0) paidSales FROM item_balances i JOIN order_balances o ON o.id=i.order_id WHERE i.product_id=? AND o.status<>'void' AND o.created_at>=? AND o.created_at<?",
    id,
    start,
    end,
  );
  const [restocks, latest, events] = await Promise.all([
    first(
      db,
      "SELECT COALESCE(SUM(json_extract(detail,'$.amount')),0) spending FROM audit WHERE target=? AND kind='stock_received' AND created_at>=? AND created_at<?",
      id,
      start,
      end,
    ),
    first(
      db,
      "SELECT detail FROM audit WHERE target=? AND kind='stock_received' ORDER BY created_at DESC,id DESC LIMIT 1",
      id,
    ),
    historyPage(db, { role: "admin" }, "events", {
      ...options,
      admin: true,
      productId: id,
    }),
  ]);
  return {
    stats: {
      ...stats,
      profit: stats!.unknownUnits
        ? null
        : stats!.sales - stats!.tax - stats!.knownCost,
    },
    restockSpending: restocks!.spending,
    latestRestock: latest ? JSON.parse(latest.detail) : null,
    events: events.records,
    nextCursor: events.nextCursor,
  };
}
