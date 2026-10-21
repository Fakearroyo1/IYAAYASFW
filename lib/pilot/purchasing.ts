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
  uid,
  audit,
} from "./core";
import { operation, noteText } from "./operation";
import { dateRange, cursorFor, cursorValue } from "./history";
import { inventoryRows } from "./autopilot";
import { accountGuard, movement, moneySummary, effectiveTime } from "./money";
import {
  allocateReceipt,
  estimateRun,
  proportionalReceiptCost,
} from "./purchase-math";
export const PURCHASE_ACTIONS = [
  "purchaseOption",
  "runCreate",
  "runSave",
  "runStart",
  "runCancel",
  "runPurchase",
  "purchaseReceive",
  "purchaseCorrect",
  "runRepeat",
  "saleCostCorrect",
  "purchaseDirect",
];
const MAX_LINES = 400;
export async function purchaseOptions(db: DB, product?: string) {
  return rows(
    db,
    "SELECT * FROM purchase_options WHERE (?='' OR product_id=?) ORDER BY preferred DESC,supplier,units_per_pack,id",
    product || "",
    product || "",
  );
}
export async function optionStatements(
  db: DB,
  product: string,
  variant: string,
  value: Row,
  actor: string,
) {
  const id = value.id ? str(value.id, 80) : uid(),
    old = await first(db, "SELECT * FROM purchase_options WHERE id=?", id),
    supplier = str(value.supplier || "", 100),
    units = int(value.unitsPerPack, 1, 10000),
    price = value.packPrice == null ? null : int(value.packPrice, 0, 10000000),
    priceAt =
      price === null ? null : effectiveTime(value.priceAt ?? Date.now()),
    kind = value.priceKind || "default";
  if (!["default", "quote"].includes(kind))
    fail(
      "Saved prices must identify a default or quote; confirmed prices come from receipts.",
    );
  if (old && (old.product_id !== product || old.variant_id !== variant))
    fail("A purchase option cannot move to a different product.", 409);
  const statements = [
    guard(
      db,
      "COALESCE((SELECT version FROM purchase_options WHERE id=?),-1)=?",
      id,
      old ? int(value.version) : -1,
    ),
  ];
  if (value.preferred !== false)
    statements.push(
      stmt(
        db,
        "UPDATE purchase_options SET preferred=0,version=version+1 WHERE product_id=? AND variant_id=? AND preferred=1 AND id<>?",
        product,
        variant,
        id,
      ),
    );
  statements.push(
    stmt(
      db,
      `INSERT INTO purchase_options(id,product_id,variant_id,supplier,pack_label,units_per_pack,pack_price,price_at,price_kind,source_id,preferred,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET supplier=excluded.supplier,pack_label=excluded.pack_label,units_per_pack=excluded.units_per_pack,pack_price=excluded.pack_price,price_at=excluded.price_at,price_kind=excluded.price_kind,source_id=excluded.source_id,preferred=excluded.preferred,active=excluded.active,version=purchase_options.version+1`,
      id,
      product,
      variant,
      supplier,
      str(value.packLabel || "", 80),
      units,
      price,
      priceAt,
      kind,
      id,
      value.preferred === false ? 0 : 1,
      value.active === false ? 0 : 1,
    ),
    audit(db, actor, "purchase_option_saved", product, {
      optionId: id,
      unitsPerPack: units,
      packPrice: price,
      priceKind: kind,
    }),
  );
  return { id, statements };
}
export async function planningCatalog(db: DB) {
  const [inventory, options, incoming, prices, settings] = await Promise.all([
    inventoryRows(db),
    purchaseOptions(db),
    rows(
      db,
      `SELECT l.product_id,COALESCE(l.variant_id,'') option_id,SUM(l.qty-l.received_qty-COALESCE((SELECT SUM(qty-stock_qty) FROM purchase_corrections WHERE purchase_line_id=l.id),0)) incoming FROM purchase_lines l GROUP BY l.product_id,l.variant_id`,
    ),
    rows(
      db,
      `SELECT l.*,r.purchased_at,r.id receipt_id FROM purchase_lines l JOIN purchase_receipts r ON r.id=l.receipt_id WHERE l.qty>COALESCE((SELECT SUM(qty) FROM purchase_corrections c WHERE c.purchase_line_id=l.id AND c.kind='return'),0) ORDER BY r.purchased_at DESC,r.id DESC,l.id DESC`,
    ),
    first(db, "SELECT * FROM workflow_settings WHERE id='main'"),
  ]);
  const items = inventory.map<Row>((p) => {
    const choices = options
      .filter(
        (o) =>
          o.product_id === p.product_id &&
          o.variant_id === p.option_id &&
          o.active,
      )
      .map<Row>((o) => {
        const latest = prices.find(
          (l) =>
            l.product_id === o.product_id &&
            (l.variant_id || "") === o.variant_id &&
            l.supplier === o.supplier &&
            l.units_per_pack === o.units_per_pack,
        );
        return {
          ...o,
          ...(latest
            ? {
                pack_price: latest.pack_price,
                price_at: latest.purchased_at,
                price_kind: "purchase",
                source_id: latest.receipt_id,
              }
            : {}),
          stale:
            !(latest?.purchased_at || o.price_at) ||
            Date.now() - (latest?.purchased_at || o.price_at) >
              settings!.price_fresh_days * 86400000,
        };
      });
    const arriving = Math.max(
      0,
      incoming.find(
        (x) => x.product_id === p.product_id && x.option_id === p.option_id,
      )?.incoming || 0,
    );
    return {
      ...p,
      incoming: arriving,
      purchaseOptions: choices,
      suggested:
        Math.max(
          0,
          Math.ceil(
            (p.target - p.available - arriving) /
              (choices[0]?.units_per_pack || p.pack_size),
          ),
        ) * (choices[0]?.units_per_pack || p.pack_size),
      demandBasis: p.units
        ? "Recorded 30-day sales; stockout exposure is unknown"
        : "Not enough demand history",
    };
  });
  return {
    items: items.sort(
      (a, b) =>
        (a.available === 0 ? 0 : a.available <= a.safety_units ? 1 : 2) -
          (b.available === 0 ? 0 : b.available <= b.safety_units ? 1 : 2) ||
        a.name.localeCompare(b.name),
    ),
    settings,
  };
}
const runLines = (db: DB, id: string) =>
  rows(
    db,
    `SELECT i.id,i.run_id,i.product_id,i.option_id,i.suggested_qty,p.name,p.category,COALESCE(v.label,'') variant_label,d.* FROM restock_run_items i JOIN workflow_run_lines d ON d.line_id=i.id JOIN products p ON p.id=i.product_id LEFT JOIN product_variants v ON v.id=i.option_id WHERE i.run_id=? ORDER BY i.id`,
    id,
  );
export async function runDetail(
  db: DB,
  id: string,
): Promise<{
  run: Row;
  lines: Row[];
  receipts: Row[];
  purchaseLines: Row[];
  corrections?: Row[];
  estimate?: ReturnType<typeof estimateRun>;
}> {
  const run = await first(
    db,
    "SELECT r.*,w.stage,w.estimated_charges,w.estimated_discount,w.started_at,w.completed_at FROM restock_runs r LEFT JOIN workflow_runs w ON w.run_id=r.id WHERE r.id=?",
    str(id, 80),
  );
  if (!run) fail("Run not found.", 404);
  if (!run.stage)
    return {
      run: {
        ...run,
        legacy: true,
        stage: run.status === "received" ? "completed" : run.status,
      },
      lines: await rows(
        db,
        "SELECT i.*,p.name FROM restock_run_items i JOIN products p ON p.id=i.product_id WHERE run_id=?",
        id,
      ),
      receipts: [],
      purchaseLines: [],
    };
  const [lines, receipts, purchased, settings, corrections] = await Promise.all(
    [
      runLines(db, id),
      rows(
        db,
        "SELECT * FROM purchase_receipts WHERE run_id=? ORDER BY purchased_at,id",
        id,
      ),
      rows(
        db,
        "SELECT l.* FROM purchase_lines l JOIN purchase_receipts r ON r.id=l.receipt_id WHERE r.run_id=?",
        id,
      ),
      first(db, "SELECT * FROM workflow_settings WHERE id='main'"),
      rows(
        db,
        "SELECT c.* FROM purchase_corrections c JOIN purchase_lines l ON l.id=c.purchase_line_id JOIN purchase_receipts r ON r.id=l.receipt_id WHERE r.run_id=?",
        id,
      ),
    ],
  );
  return {
    run,
    lines,
    receipts,
    purchaseLines: purchased,
    corrections,
    estimate: estimateRun(
      lines as any,
      run.estimated_charges,
      run.estimated_discount,
      settings!.price_fresh_days,
    ),
  };
}
export async function runHistory(db: DB, q: Row = {}) {
  const { start, end } = dateRange(q.from, q.to),
    cursor = cursorValue(q.cursor),
    limit = int(Number(q.limit || 30), 1, 100),
    where = ["r.created_at>=? AND r.created_at<?"],
    values: unknown[] = [start, Math.min(end, Number(q.until) || end)];
  if (q.search) {
    where.push(
      "(instr(lower(r.name),lower(?))>0 OR EXISTS(SELECT 1 FROM purchase_receipts p WHERE p.run_id=r.id AND instr(lower(p.supplier),lower(?))>0))",
    );
    values.push(str(q.search, 100), str(q.search, 100));
  }
  if (q.status) {
    where.push(
      "COALESCE(w.stage,CASE r.status WHEN 'received' THEN 'completed' ELSE r.status END)=?",
    );
    values.push(str(q.status, 20));
  }
  if (cursor) {
    where.push("(r.created_at<? OR (r.created_at=? AND r.id<?))");
    values.push(cursor.t, cursor.t, cursor.id);
  }
  const found = await rows(
      db,
      `SELECT r.*,COALESCE(w.stage,CASE r.status WHEN 'received' THEN 'completed' ELSE r.status END) stage,w.run_id IS NULL legacy,m.name shopper,
 COALESCE((SELECT SUM(total) FROM purchase_receipts p WHERE p.run_id=r.id),(SELECT SUM(total_cost) FROM restock_run_items WHERE run_id=r.id)) total,
 (SELECT SUM(qty) FROM purchase_lines l JOIN purchase_receipts p ON p.id=l.receipt_id WHERE p.run_id=r.id) purchased_units,
 (SELECT group_concat(DISTINCT supplier) FROM purchase_receipts p WHERE p.run_id=r.id) suppliers
 FROM restock_runs r LEFT JOIN workflow_runs w ON w.run_id=r.id LEFT JOIN members m ON m.id=r.actor WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`,
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
export async function fundsProjection(db: DB) {
  const funds = await moneySummary(db),
    settings = await first(
      db,
      "SELECT * FROM workflow_settings WHERE id='main'",
    );
  let plan = null;
  if (settings?.selected_run) {
    const d = await runDetail(db, settings.selected_run);
    if (d.estimate) {
      const committed = funds.commitments
        .filter((c) => c.run_id === settings.selected_run)
        .reduce((n, c) => n + c.amount, 0);
      plan = {
        id: d.run.id,
        name: d.run.name,
        ...d.estimate,
        alreadyCommitted: committed,
        remainingDeduction:
          d.estimate.total === null
            ? null
            : Math.max(0, d.estimate.total - committed),
      };
    }
  }
  return {
    ...funds,
    settings,
    plan,
    projected:
      funds.available !== null && plan?.remainingDeduction != null
        ? funds.available - plan.remainingDeduction
        : null,
  };
}
async function plannedLine(
  db: DB,
  item: Row,
  catalog: Awaited<ReturnType<typeof planningCatalog>>,
) {
  const product = str(item.productId, 80),
    variant = str(item.variantId || "", 80),
    p = catalog.items.find(
      (x) => x.product_id === product && x.option_id === variant,
    );
  if (!p) fail("Choose a current stocked product or option.");
  const option = item.purchaseOptionId
    ? p.purchaseOptions.find((x: Row) => x.id === item.purchaseOptionId)
    : p.purchaseOptions[0];
  if (item.purchaseOptionId && !option)
    fail("The purchase option changed. Choose it again.", 409);
  const units = int(
      item.unitsPerPack ?? option?.units_per_pack ?? p.pack_size,
      1,
      10000,
    ),
    packs = int(
      item.packs ?? Math.max(1, Math.ceil(p.suggested / units)),
      1,
      10000,
    );
  if (packs * units > 100000) fail("Keep a run line within 100,000 units.");
  const quoted = item.packPrice !== undefined,
    price = quoted
      ? item.packPrice === null
        ? null
        : int(item.packPrice, 0, 10000000)
      : option &&
          option.units_per_pack === units &&
          str(item.supplier ?? option.supplier, 100) === option.supplier
        ? option.pack_price
        : null;
  return {
    id: uid(),
    productId: product,
    variantId: variant,
    suggested: p.suggested,
    purchaseOptionId: option?.id || null,
    packs,
    units,
    price,
    source: quoted ? "run quote" : option?.source_id || "missing",
    priceAt: quoted ? Date.now() : option?.price_at || null,
    priceKind: quoted ? "quote" : option?.price_kind || "missing",
    supplier: str(item.supplier ?? option?.supplier ?? p.vendor, 100),
    packLabel: option?.pack_label || "",
  };
}
const addLines = (db: DB, run: string, list: Row[]) => [
  stmt(
    db,
    `INSERT INTO restock_run_items(id,run_id,product_id,option_id,suggested_qty,qty,vendor) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.productId'),json_extract(value,'$.variantId'),json_extract(value,'$.suggested'),0,json_extract(value,'$.supplier') FROM json_each(?)`,
    run,
    JSON.stringify(list),
  ),
  stmt(
    db,
    `INSERT INTO workflow_run_lines(line_id,purchase_option_id,planned_packs,planned_pack_units,planned_pack_price,price_source,price_at,price_kind,supplier,pack_label) SELECT json_extract(value,'$.id'),json_extract(value,'$.purchaseOptionId'),json_extract(value,'$.packs'),json_extract(value,'$.units'),json_extract(value,'$.price'),json_extract(value,'$.source'),json_extract(value,'$.priceAt'),json_extract(value,'$.priceKind'),json_extract(value,'$.supplier'),json_extract(value,'$.packLabel') FROM json_each(?)`,
    JSON.stringify(list),
  ),
];

// One JSON batch applies any number of selected receipt lines within the bounded
// request. It does not consume one D1 query per product. Guards and stock/cost
// changes commit together with receipt links and the operation identifier.
async function receiveStatements(
  db: DB,
  m: Row,
  operationId: string,
  selected: Row[],
  newLines = false,
) {
  if (!selected.length || selected.length > MAX_LINES)
    fail("Choose items to add to stock.");
  const stock = await rows(
      db,
      `SELECT p.id product_id,'' variant_id,p.stock,p.cost,p.version FROM products p UNION ALL SELECT v.product_id,v.id,v.stock,COALESCE(v.cost,p.cost),v.version FROM product_variants v JOIN products p ON p.id=v.product_id`,
    ),
    entries: Row[] = [],
    seen = new Set<string>();
  for (const x of selected) {
    const key = x.product_id + ":" + (x.variant_id || "");
    if (seen.has(key)) fail("Receive one line per product/option at a time.");
    seen.add(key);
    const p = stock.find(
      (p) =>
        p.product_id === x.product_id && p.variant_id === (x.variant_id || ""),
    );
    if (!p) fail("The product no longer exists.");
    const qty = int(x.receiveQty, 1, x.qty - x.received_qty),
      previous = x.received_qty || 0,
      total = proportionalReceiptCost(x.total_cost, x.qty, previous, qty),
      newCost =
        p.stock === 0
          ? Math.round(total / qty)
          : p.cost === null
            ? null
            : Math.round((p.stock * p.cost + total) / (p.stock + qty));
    entries.push({
      id: operationId + ":" + x.id,
      lineId: x.id,
      productId: x.product_id,
      variantId: x.variant_id || "",
      qty,
      total,
      previous,
      version: x.version || 0,
      oldStock: p.stock,
      oldVersion: p.version,
      newCost,
      remainder: newCost === null ? null : total - qty * newCost,
    });
  }
  const json = JSON.stringify(entries),
    now = Date.now();
  const s = [
    guard(
      db,
      `NOT EXISTS(SELECT 1 FROM json_each(?) x WHERE NOT EXISTS(SELECT 1 FROM purchase_lines l WHERE l.id=json_extract(x.value,'$.lineId') AND l.received_qty=json_extract(x.value,'$.previous') AND l.version=json_extract(x.value,'$.version') AND l.qty-l.received_qty-COALESCE((SELECT SUM(c.qty-c.stock_qty) FROM purchase_corrections c WHERE c.purchase_line_id=l.id),0)>=json_extract(x.value,'$.qty')))`,
      json,
    ),
    guard(
      db,
      `NOT EXISTS(SELECT 1 FROM json_each(?) x WHERE CASE WHEN json_extract(x.value,'$.variantId')='' THEN NOT EXISTS(SELECT 1 FROM products WHERE id=json_extract(x.value,'$.productId') AND stock=json_extract(x.value,'$.oldStock') AND version=json_extract(x.value,'$.oldVersion')) ELSE NOT EXISTS(SELECT 1 FROM product_variants WHERE id=json_extract(x.value,'$.variantId') AND product_id=json_extract(x.value,'$.productId') AND stock=json_extract(x.value,'$.oldStock') AND version=json_extract(x.value,'$.oldVersion')) END)`,
      json,
    ),
  ];
  for (const [table, key, condition] of [
    ["products", "productId", "json_extract(value,'$.variantId')=''"],
    ["product_variants", "variantId", "json_extract(value,'$.variantId')<>''"],
  ])
    s.push(
      stmt(
        db,
        `UPDATE ${table} SET stock=stock+(SELECT json_extract(value,'$.qty') FROM json_each(?) WHERE ${condition} AND json_extract(value,'$.${key}')=${table}.id),cost=(SELECT json_extract(value,'$.newCost') FROM json_each(?) WHERE ${condition} AND json_extract(value,'$.${key}')=${table}.id),version=version+1 WHERE id IN(SELECT json_extract(value,'$.${key}') FROM json_each(?) WHERE ${condition})`,
        json,
        json,
        json,
      ),
    );
  s.push(
    stmt(
      db,
      `INSERT INTO restock_entries(id,product_id,variant_id,qty,total_cost,reference,created_at,actor) SELECT json_extract(value,'$.id'),json_extract(value,'$.productId'),NULLIF(json_extract(value,'$.variantId'),''),json_extract(value,'$.qty'),json_extract(value,'$.total'),'receipt-line:'||json_extract(value,'$.lineId'),?,? FROM json_each(?) WHERE json_extract(value,'$.total')>0`,
      now,
      m.id,
      json,
    ),
    stmt(
      db,
      `INSERT INTO stock_receipt_links(id,purchase_line_id,restock_entry_id,qty,total_cost,actor,created_at,inventory_unit_cost,rounding_remainder) SELECT json_extract(value,'$.id'),json_extract(value,'$.lineId'),CASE WHEN json_extract(value,'$.total')>0 THEN json_extract(value,'$.id') ELSE NULL END,json_extract(value,'$.qty'),json_extract(value,'$.total'),?,?,json_extract(value,'$.newCost'),json_extract(value,'$.remainder') FROM json_each(?)`,
      m.id,
      now,
      json,
    ),
    stmt(
      db,
      `UPDATE purchase_lines SET received_qty=received_qty+(SELECT json_extract(value,'$.qty') FROM json_each(?) WHERE json_extract(value,'$.lineId')=purchase_lines.id),version=version+1 WHERE id IN(SELECT json_extract(value,'$.lineId') FROM json_each(?))`,
      json,
      json,
    ),
  );
  return s;
}
const completeRun = (db: DB, run: string, now: number) => [
  stmt(
    db,
    `UPDATE workflow_runs SET stage='completed',completed_at=? WHERE run_id=? AND stage='purchased' AND NOT EXISTS(SELECT 1 FROM workflow_run_lines d JOIN restock_run_items i ON i.id=d.line_id WHERE i.run_id=? AND d.state NOT IN('purchased','skipped')) AND NOT EXISTS(SELECT 1 FROM purchase_lines l JOIN purchase_receipts r ON r.id=l.receipt_id WHERE r.run_id=? AND l.received_qty+COALESCE((SELECT SUM(qty-stock_qty) FROM purchase_corrections WHERE purchase_line_id=l.id),0)<l.qty)`,
    now,
    run,
    run,
    run,
  ),
  stmt(
    db,
    "UPDATE restock_runs SET status='received',received_at=? WHERE id=? AND EXISTS(SELECT 1 FROM workflow_runs WHERE run_id=? AND stage='completed')",
    now,
    run,
    run,
  ),
];

export async function mutatePurchasing(db: DB, m: Row, b: Row, token?: string) {
  const op = await operation(db, m, b, true, token);
  if (op.replayed) return { ok: true, id: b.id || op.id, replayed: true };
  const now = Date.now(),
    s: D1PreparedStatement[] = [];
  let result: Row = { ok: true, id: b.id || op.id };
  let direct: Row | null = null;
  if (b.action === "purchaseDirect") {
    if (
      !Array.isArray(b.items) ||
      !b.items.length ||
      b.items.length > MAX_LINES
    )
      fail("Choose 1–400 receipt items.");
    const catalog = await planningCatalog(db),
      list: Row[] = [];
    for (const item of b.items) list.push(await plannedLine(db, item, catalog));
    if (
      new Set(list.map((l) => l.productId + ":" + l.variantId)).size !==
        list.length ||
      list.some((l) => l.price === null)
    )
      fail("Choose each product once and enter every pack price.");
    s.push(
      stmt(
        db,
        "INSERT INTO restock_runs(id,name,actor,created_at) VALUES(?,?,?,?)",
        op.id,
        "Direct receipt: " + str(b.reference, 100),
        m.id,
        now,
      ),
      stmt(
        db,
        "INSERT INTO workflow_runs(run_id,stage,started_at) VALUES(?,'shopping',?)",
        op.id,
        now,
      ),
      ...addLines(db, op.id, list),
      stmt(
        db,
        "UPDATE workflow_run_lines SET state='grabbed',actual_packs=planned_packs,actual_pack_units=planned_pack_units,actual_pack_price=planned_pack_price WHERE line_id IN(SELECT id FROM restock_run_items WHERE run_id=?)",
        op.id,
      ),
    );
    direct = {
      run: { id: op.id, stage: "shopping", version: 0 },
      receipts: [],
      lines: list.map((l) => ({
        id: l.id,
        product_id: l.productId,
        option_id: l.variantId,
        purchase_option_id: l.purchaseOptionId,
        name: catalog.items.find(
          (p) => p.product_id === l.productId && p.option_id === l.variantId,
        )!.name,
        variant_label:
          catalog.items.find(
            (p) => p.product_id === l.productId && p.option_id === l.variantId,
          )!.variant_label || "",
        state: "grabbed",
        actual_packs: l.packs,
        actual_pack_units: l.units,
        actual_pack_price: l.price,
        line_discount: 0,
      })),
    };
  }
  if (b.action === "purchaseOption") {
    const p = str(b.productId, 80),
      v = str(b.variantId || "", 80);
    s.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM products WHERE id=?) AND (?='' OR EXISTS(SELECT 1 FROM product_variants WHERE id=? AND product_id=?))",
        p,
        v,
        v,
        p,
      ),
    );
    const option = await optionStatements(db, p, v, b, m.id);
    s.push(...option.statements);
    result.id = option.id;
  } else if (b.action === "runCreate" || b.action === "runRepeat") {
    const catalog = await planningCatalog(db);
    let items = b.items;
    if (b.action === "runRepeat") {
      const d = await runDetail(db, str(b.id, 80));
      items = d.lines
        .map((l) => {
          const current = catalog.items.find(
            (p) => p.product_id === l.product_id && p.option_id === l.option_id,
          );
          if (!current) return null;
          const option =
            current.purchaseOptions.find(
              (o: Row) => o.id === l.purchase_option_id,
            ) || current.purchaseOptions[0];
          return {
            productId: l.product_id,
            variantId: l.option_id,
            purchaseOptionId: option?.id,
            packs: Math.max(
              1,
              Math.ceil(
                (current.suggested || 1) /
                  (option?.units_per_pack || current.pack_size || 1),
              ),
            ),
          };
        })
        .filter(Boolean);
    }
    if (!Array.isArray(items) || !items.length || items.length > MAX_LINES)
      fail("Choose between 1 and 400 stock items.");
    const list: Row[] = [];
    for (const x of items) list.push(await plannedLine(db, x, catalog));
    if (
      new Set(list.map((x) => x.productId + ":" + x.variantId)).size !==
      list.length
    )
      fail("Choose each product/option once.");
    s.push(
      stmt(
        db,
        "INSERT INTO restock_runs(id,name,actor,created_at) VALUES(?,?,?,?)",
        op.id,
        noteText(b.name || "Shopping run", 100, 1),
        m.id,
        now,
      ),
      stmt(
        db,
        "INSERT INTO workflow_runs(run_id,stage,estimated_charges,estimated_discount) VALUES(?,'planning',?,?)",
        op.id,
        b.charges == null ? null : int(b.charges, 0, 10000000),
        int(b.discount || 0, 0, 10000000),
      ),
      ...addLines(db, op.id, list),
      stmt(
        db,
        "UPDATE workflow_settings SET selected_run=COALESCE(selected_run,?),version=version+1 WHERE id='main'",
        op.id,
      ),
    );
    result.id = op.id;
  } else if (
    [
      "runSave",
      "runStart",
      "runCancel",
      "runPurchase",
      "purchaseDirect",
    ].includes(b.action)
  ) {
    const d: Row = direct || (await runDetail(db, str(b.id, 80))),
      r = d.run;
    if (r.legacy) fail("Use the legacy run controls for this historical run.");
    if (["completed", "cancelled"].includes(r.stage))
      fail("This run is closed. Open its receipt to record a correction.", 409);
    s.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM restock_runs WHERE id=? AND version=?)",
        r.id,
        direct ? 0 : int(b.version),
      ),
    );
    if (b.action === "runStart") {
      if (r.stage !== "planning") fail("This run already started.", 409);
      s.push(
        stmt(
          db,
          "UPDATE workflow_runs SET stage='shopping',started_at=? WHERE run_id=?",
          now,
          r.id,
        ),
      );
    } else if (b.action === "runCancel") {
      if (d.receipts.length)
        fail("A purchased run needs a receipt correction, not cancellation.");
      s.push(
        stmt(
          db,
          "UPDATE workflow_runs SET stage='cancelled' WHERE run_id=?",
          r.id,
        ),
        stmt(db, "UPDATE restock_runs SET status='cancelled' WHERE id=?", r.id),
        stmt(
          db,
          "UPDATE money_commitments SET status='cancelled',version=version+1 WHERE run_id=? AND status='open'",
          r.id,
        ),
      );
    } else if (b.action === "runSave") {
      if (b.add) {
        if (d.lines.length >= MAX_LINES)
          fail("This run already has 400 items.");
        s.push(
          ...addLines(db, r.id, [
            await plannedLine(db, b.add, await planningCatalog(db)),
          ]),
        );
      }
      if (b.lines) {
        if (!Array.isArray(b.lines) || b.lines.length > MAX_LINES)
          fail("Choose valid run lines.");
        const updates: Row[] = [];
        for (const x of b.lines) {
          const old = d.lines.find((l: Row) => l.id === x.id);
          if (!old || old.state === "purchased")
            fail(
              "A purchased line cannot be edited; record a receipt correction.",
            );
          const state = str(x.state || old.state, 20);
          if (!["needed", "grabbed", "skipped"].includes(state))
            fail("Choose Still needed, Grabbed, or Skip.");
          if (r.stage === "planning" && state === "grabbed")
            fail("Start the run before marking items grabbed.");
          const packs = int(x.packs ?? old.planned_packs, 1, 10000),
            units = int(x.unitsPerPack ?? old.planned_pack_units, 1, 10000),
            price =
              (x.packPrice === undefined
                ? old.planned_pack_price
                : x.packPrice) == null
                ? null
                : int(x.packPrice ?? old.planned_pack_price, 0, 10000000),
            discount = int(x.discount || 0, 0, 10000000);
          if (
            packs * units > 100000 ||
            (state === "grabbed" &&
              (price === null || packs * price < discount))
          )
            fail("Enter packs, units and a nonnegative receipt line total.");
          updates.push({
            id: x.id,
            state,
            packs,
            units,
            price,
            discount,
            note: str(x.note || "", 300),
          });
        }
        const data = JSON.stringify(updates);
        s.push(
          stmt(
            db,
            `UPDATE workflow_run_lines SET state=(SELECT json_extract(value,'$.state') FROM json_each(?) WHERE json_extract(value,'$.id')=line_id),actual_packs=(SELECT json_extract(value,'$.packs') FROM json_each(?) WHERE json_extract(value,'$.id')=line_id),actual_pack_units=(SELECT json_extract(value,'$.units') FROM json_each(?) WHERE json_extract(value,'$.id')=line_id),actual_pack_price=(SELECT json_extract(value,'$.price') FROM json_each(?) WHERE json_extract(value,'$.id')=line_id),line_discount=(SELECT json_extract(value,'$.discount') FROM json_each(?) WHERE json_extract(value,'$.id')=line_id),note=(SELECT json_extract(value,'$.note') FROM json_each(?) WHERE json_extract(value,'$.id')=line_id) WHERE line_id IN(SELECT json_extract(value,'$.id') FROM json_each(?))`,
            data,
            data,
            data,
            data,
            data,
            data,
            data,
          ),
        );
        if (r.stage === "planning")
          s.push(
            stmt(
              db,
              "UPDATE workflow_run_lines SET planned_packs=actual_packs,planned_pack_units=actual_pack_units,planned_pack_price=actual_pack_price,price_source='run quote',price_kind='quote',price_at=? WHERE line_id IN(SELECT json_extract(value,'$.id') FROM json_each(?))",
              now,
              data,
            ),
          );
      }
      if (b.charges !== undefined || b.discount !== undefined)
        s.push(
          stmt(
            db,
            "UPDATE workflow_runs SET estimated_charges=?,estimated_discount=? WHERE run_id=?",
            b.charges === undefined
              ? r.estimated_charges
              : b.charges === null
                ? null
                : int(b.charges, 0, 10000000),
            b.discount === undefined
              ? r.estimated_discount
              : int(b.discount, 0, 10000000),
            r.id,
          ),
        );
    } else {
      if (
        !["shopping", "purchased"].includes(r.stage) ||
        b.confirmed !== true ||
        b.chargesValidated !== true
      )
        fail("Review the receipt and recheck its charges before posting.");
      const ids = direct ? direct.lines.map((l: Row) => l.id) : b.lineIds;
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        new Set(ids).size !== ids.length
      )
        fail("Select the grabbed items on this receipt.");
      const lines: Row[] = ids.map((id: string) =>
        d.lines.find((l: Row) => l.id === id),
      );
      if (lines.some((l) => !l || l.state !== "grabbed"))
        fail("Some receipt lines changed. Review the run again.", 409);
      const charges = int(b.charges, 0, 10000000),
        discount = int(b.discount || 0, 0, 10000000),
        amounts = lines.map(
          (l) => l!.actual_packs * l!.actual_pack_price - l!.line_discount,
        ),
        merchandise = amounts.reduce((a, n) => a + n, 0),
        total = merchandise + charges - discount;
      if (total < 0 || total !== int(b.total, 0, 100000000))
        fail(
          "Receipt and line totals differ. Correct the prices or record the actual shared charges/discount.",
        );
      const allocations = allocateReceipt(amounts, charges - discount),
        funding = b.funding === "personal" ? "personal" : "activity",
        a = funding === "activity" ? await accountGuard(db, b.account) : null,
        purchaser =
          funding === "personal" ? noteText(b.purchaser, 100, 1) : null,
        reference = noteText(b.reference, 200, 1),
        supplier = noteText(b.supplier, 100, 1),
        purchased = effectiveTime(b.purchasedAt),
        receipt = op.id;
      if (
        await first(
          db,
          "SELECT month FROM accounting_periods WHERE month=strftime('%Y-%m',?/1000,'unixepoch') AND status='closed'",
          purchased,
        )
      )
        fail("Reopen that accounting month before recording a receipt.", 409);
      const image = b.image ? str(b.image, 500) : null;
      if (image && !/^\/api\/product-images\?id=[\w.-]+$/.test(image))
        fail("Choose an uploaded receipt image.");
      s.push(
        guard(
          db,
          "NOT EXISTS(SELECT 1 FROM accounting_periods WHERE month=strftime('%Y-%m',?/1000,'unixepoch') AND status='closed')",
          purchased,
        ),
      );
      if (a) s.push(a.statement);
      s.push(
        stmt(
          db,
          "INSERT INTO expenses(id,kind,amount,description,created_at) VALUES(?,'stock',?,?,?)",
          receipt,
          total,
          "Restock: " + reference,
          purchased,
        ),
        stmt(
          db,
          "INSERT INTO purchase_receipts(id,run_id,expense_id,supplier,reference,image,purchased_at,created_at,actor,funding,account_id,purchaser,merchandise,charges,discount,total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          receipt,
          r.id,
          receipt,
          supplier,
          reference,
          image,
          purchased,
          now,
          m.id,
          funding,
          a?.account || null,
          purchaser,
          merchandise,
          charges,
          discount,
          total,
        ),
      );
      const snapshots = lines.map((l, i) => ({
          id: receipt + ":" + i,
          receipt,
          runLine: l!.id,
          product: l!.product_id,
          variant: l!.option_id || null,
          option: l!.purchase_option_id,
          name: l!.name,
          label: l!.variant_label,
          supplier,
          packs: l!.actual_packs,
          units: l!.actual_pack_units,
          qty: l!.actual_packs * l!.actual_pack_units,
          price: l!.actual_pack_price,
          discount: l!.line_discount,
          charges: allocations[i].charges,
          total: allocations[i].total,
        })),
        data = JSON.stringify(snapshots);
      s.push(
        stmt(
          db,
          `INSERT INTO purchase_lines(id,receipt_id,run_line_id,product_id,variant_id,purchase_option_id,product_name,variant_label,supplier,packs,units_per_pack,qty,pack_price,line_discount,allocated_charges,total_cost,price_source,price_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.receipt'),json_extract(value,'$.runLine'),json_extract(value,'$.product'),json_extract(value,'$.variant'),json_extract(value,'$.option'),json_extract(value,'$.name'),json_extract(value,'$.label'),json_extract(value,'$.supplier'),json_extract(value,'$.packs'),json_extract(value,'$.units'),json_extract(value,'$.qty'),json_extract(value,'$.price'),json_extract(value,'$.discount'),json_extract(value,'$.charges'),json_extract(value,'$.total'),'entered-at-purchase',? FROM json_each(?)`,
          purchased,
          data,
        ),
        stmt(
          db,
          "UPDATE workflow_run_lines SET state='purchased' WHERE line_id IN(SELECT value FROM json_each(?))",
          JSON.stringify(ids),
        ),
        stmt(
          db,
          "UPDATE workflow_runs SET stage='purchased',estimated_charges=NULL,estimated_discount=0 WHERE run_id=?",
          r.id,
        ),
        stmt(
          db,
          "UPDATE money_commitments SET amount=MAX(0,amount-?),status=CASE WHEN amount<=? THEN 'settled' ELSE 'open' END,version=version+1 WHERE run_id=? AND status='open'",
          total,
          total,
          r.id,
        ),
      );
      if (a)
        s.push(
          movement(db, {
            id: receipt,
            account: a.account,
            amount: -total,
            category: "stock",
            sourceType: "receipt",
            sourceId: receipt,
            effective: purchased,
            actor: m.id,
            reference,
          }),
        );
      else
        s.push(
          stmt(
            db,
            "INSERT INTO reimbursements(receipt_id,purchaser,amount) VALUES(?,?,?)",
            receipt,
            purchaser,
            total,
          ),
        );
      if (b.updateDefaults === true)
        s.push(
          stmt(
            db,
            `UPDATE purchase_options SET pack_price=(SELECT json_extract(value,'$.price') FROM json_each(?) WHERE json_extract(value,'$.option')=purchase_options.id AND json_extract(value,'$.units')=purchase_options.units_per_pack AND json_extract(value,'$.supplier')=purchase_options.supplier),price_at=?,price_kind='purchase',source_id=?,version=version+1 WHERE id IN(SELECT json_extract(value,'$.option') FROM json_each(?) WHERE json_extract(value,'$.units')=purchase_options.units_per_pack AND json_extract(value,'$.supplier')=purchase_options.supplier)`,
            data,
            purchased,
            receipt,
            data,
          ),
        );
      if (b.receiveNow === true)
        s.push(
          ...(await receiveStatements(
            db,
            m,
            op.id,
            snapshots.map((l) => ({
              id: l.id,
              product_id: l.product,
              variant_id: l.variant,
              qty: l.qty,
              total_cost: l.total,
              received_qty: 0,
              version: 0,
              receiveQty: l.qty,
            })),
            true,
          )),
        );
      s.push(...completeRun(db, r.id, now));
      result.receiptId = receipt;
    }
    s.push(
      stmt(db, "UPDATE restock_runs SET version=version+1 WHERE id=?", r.id),
    );
    if (b.action === "runSave") s.push(...completeRun(db, r.id, now));
  } else if (b.action === "purchaseReceive") {
    if (
      !Array.isArray(b.lines) ||
      !b.lines.length ||
      b.lines.length > MAX_LINES
    )
      fail("Choose receipt lines to stock.");
    const receipt = await first(
      db,
      "SELECT * FROM purchase_receipts WHERE id=?",
      str(b.receiptId, 80),
    );
    if (!receipt) fail("Receipt not found.");
    const all = await rows(
        db,
        "SELECT * FROM purchase_lines WHERE receipt_id=?",
        receipt.id,
      ),
      selected = b.lines.map((x: Row) => {
        const l = all.find((l) => l.id === x.id);
        if (!l || l.version !== x.version)
          fail(
            "Receipt quantities changed. Your input is preserved; review the remaining units.",
            409,
          );
        return { ...l, receiveQty: x.qty };
      });
    s.push(...(await receiveStatements(db, m, op.id, selected)));
    if (receipt.run_id)
      s.push(
        ...completeRun(db, receipt.run_id, now),
        stmt(
          db,
          "UPDATE restock_runs SET version=version+1 WHERE id=?",
          receipt.run_id,
        ),
      );
  } else if (b.action === "purchaseCorrect") {
    const line = await first(
      db,
      "SELECT l.*,r.funding,r.purchased_at FROM purchase_lines l JOIN purchase_receipts r ON r.id=l.receipt_id WHERE l.id=?",
      str(b.lineId, 100),
    );
    if (!line) fail("Receipt line not found.");
    const prior = await first(
        db,
        "SELECT COALESCE(SUM(qty),0) qty,COALESCE(SUM(stock_qty),0) stocked,COALESCE(SUM(refund),0) refunded FROM purchase_corrections WHERE purchase_line_id=?",
        line.id,
      ),
      kind = str(b.kind, 20),
      qty = int(b.qty, 1, line.qty - prior!.qty),
      stockQty = int(
        b.stockQty,
        0,
        Math.min(qty, line.received_qty - prior!.stocked),
      ),
      refund = int(b.refund || 0, 0, line.total_cost - prior!.refunded),
      reason = noteText(b.reason);
    if (!["return", "damage"].includes(kind) || (kind === "damage" && refund))
      fail("Record a refund only for returned goods.");
    if (
      qty - stockQty >
      line.qty - line.received_qty - (prior!.qty - prior!.stocked)
    )
      fail("Choose how many affected units were already stocked.");
    const table = line.variant_id ? "product_variants" : "products",
      key = line.variant_id || line.product_id,
      p = await first(db, `SELECT * FROM ${table} WHERE id=?`, key);
    if (!p || p.stock < stockQty)
      fail(
        "Stock changed; the correction cannot remove unavailable units.",
        409,
      );
    s.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM purchase_lines WHERE id=? AND version=?)",
        line.id,
        int(b.version),
      ),
      guard(
        db,
        `EXISTS(SELECT 1 FROM ${table} WHERE id=? AND version=? AND stock>=?)`,
        key,
        p.version,
        stockQty,
      ),
      stmt(
        db,
        `UPDATE ${table} SET stock=stock-?,version=version+1 WHERE id=?`,
        stockQty,
        key,
      ),
    );
    let refundAccount: string | null = null;
    if (refund) {
      let activityRefund = refund;
      if (line.funding === "personal") {
        const payable = await first(
          db,
          `SELECT amount-COALESCE((SELECT SUM(amount) FROM reimbursement_settlements WHERE receipt_id=r.receipt_id),0)-COALESCE((SELECT SUM(c.refund) FROM purchase_corrections c JOIN purchase_lines l ON l.id=c.purchase_line_id WHERE l.receipt_id=r.receipt_id),0) due FROM reimbursements r WHERE receipt_id=?`,
          line.receipt_id,
        );
        activityRefund = Math.max(0, refund - Math.max(0, payable!.due));
        s.push(
          guard(
            db,
            `(SELECT amount-COALESCE((SELECT SUM(amount) FROM reimbursement_settlements WHERE receipt_id=r.receipt_id),0)-COALESCE((SELECT SUM(c.refund) FROM purchase_corrections c JOIN purchase_lines l ON l.id=c.purchase_line_id WHERE l.receipt_id=r.receipt_id),0) FROM reimbursements r WHERE receipt_id=?)=?`,
            line.receipt_id,
            payable!.due,
          ),
        );
      }
      if (activityRefund) {
        const a = await accountGuard(db, b.account);
        refundAccount = a.account;
        s.push(
          a.statement,
          movement(db, {
            id: op.id,
            account: a.account,
            amount: activityRefund,
            category: "stock-refund",
            sourceType: "purchase-correction",
            sourceId: op.id,
            effective: now,
            actor: m.id,
            reference: reason,
          }),
        );
      }
      s.push(
        stmt(
          db,
          "INSERT INTO expenses(id,kind,amount,description,created_at) VALUES(?,'stock',?,?,?)",
          op.id,
          -refund,
          "Receipt return: " + reason,
          now,
        ),
      );
    }
    s.push(
      stmt(
        db,
        "INSERT INTO purchase_corrections(id,purchase_line_id,kind,qty,stock_qty,refund,account_id,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        op.id,
        line.id,
        kind,
        qty,
        stockQty,
        refund,
        refundAccount,
        reason,
        m.id,
        now,
      ),
      stmt(
        db,
        "UPDATE purchase_lines SET version=version+1 WHERE id=?",
        line.id,
      ),
    );
    const receipt = await first(
      db,
      "SELECT run_id FROM purchase_receipts WHERE id=?",
      line.receipt_id,
    );
    if (receipt?.run_id) s.push(...completeRun(db, receipt.run_id, now));
  } else if (b.action === "saleCostCorrect") {
    const id = str(b.itemId, 80),
      item = await first(
        db,
        "SELECT i.*,o.created_at FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.id=?",
        id,
      );
    if (!item || item.cost !== null)
      fail("Choose an original sale line with an unknown cost.");
    const evidence = noteText(b.evidence, 500),
      cost = int(b.cost, 0, 1000000);
    s.push(
      guard(
        db,
        "NOT EXISTS(SELECT 1 FROM accounting_periods WHERE month=strftime('%Y-%m',?/1000,'unixepoch') AND status='closed')",
        item.created_at,
      ),
      stmt(
        db,
        "INSERT INTO sale_cost_corrections(item_id,unit_cost,evidence,actor,created_at) VALUES(?,?,?,?,?)",
        id,
        cost,
        evidence,
        m.id,
        now,
      ),
    );
  } else fail("Choose a supported purchase action.");
  s.push(
    audit(db, m.id, b.action, result.id, {
      receiptId: result.receiptId || null,
    }),
  );
  await op.commit(s);
  return result;
}
