import {
  type DB,
  type Row,
  fail,
  first,
  rows,
  str,
  int,
  hash,
  uid,
  stmt,
  guard,
  audit,
  batchAtomic,
  campaignCatalog,
  sessionStatements,
  shippingQuote,
  validateAddress,
  receiptHash,
} from "./common";
import { reqId } from "../pilot/core";

export async function guestQuote(db: DB, session: Row, b: Row) {
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 20)
    fail("Choose between 1 and 20 gear options.");
  const catalog = await campaignCatalog(db, session.id),
    seen = new Set<string>(),
    quantities = new Map<string, number>();
  const lines = b.items.map((input: Row) => {
    const productId = str(input.productId, 80),
      optionId = str(input.optionId || "", 80),
      personalization = str(input.personalization || "", 80),
      qty = int(input.qty, 1, 30);
    const p = catalog.find(
      (p) => p.product_id === productId && p.option_id === optionId,
    );
    if (!p) fail("An option is no longer available. Refresh your bag.", 409);
    if (p.personalization_required && !personalization)
      fail(
        "Enter " +
          (p.personalization_label || "personalization") +
          " for " +
          p.name +
          ".",
      );
    if (
      (personalization && !p.personalization_label) ||
      personalization.length > (p.personalization_max || 30) ||
      /[\x00-\x1f\x7f]/.test(personalization)
    )
      fail("Review the personalization.");
    const key = productId + ":" + optionId,
      duplicate = JSON.stringify([key, personalization]);
    if (seen.has(duplicate)) fail("Combine duplicate selections.");
    seen.add(duplicate);
    quantities.set(key, (quantities.get(key) || 0) + qty);
    if (
      quantities.get(key)! >
      Math.min(30, p.quantity_limit - p.committed, p.preorder ? 30 : p.stock)
    )
      fail(p.name + " has insufficient availability.", 409);
    return { ...p, key, personalization, qty };
  });
  const delivery = str(b.delivery, 20),
    shipping = shippingQuote(lines, delivery, session),
    subtotal = lines.reduce((n: number, l: Row) => n + l.price * l.qty, 0),
    total = subtotal + shipping;
  if (total > 50000) fail("Keep each order at $500 or less.");
  const tax =
    lines.reduce(
      (n: number, l: Row) =>
        n + Math.round((l.price * l.qty * l.tax_bp) / (10000 + l.tax_bp)),
      0,
    ) +
    Math.round(
      (shipping * session.shipping_tax_bp) / (10000 + session.shipping_tax_bp),
    );
  return { lines, delivery, shipping, subtotal, total, tax, quantities };
}

export async function submitGuestOrder(
  db: DB,
  session: Row,
  b: Row,
  receiptSecret: string,
) {
  const id = reqId(b.requestId),
    name = str(b.name, 100),
    email = str(b.email, 254).toLowerCase(),
    method = str(b.method, 20);
  if (
    !name ||
    /[\x00-\x1f\x7f]/.test(name) ||
    !/^\S+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !["cash", "cashapp"].includes(method) ||
    b.paymentReported !== true
  )
    fail("Enter your contact details and report the payment you have made.");
  const delivery = str(b.delivery, 20),
    address = delivery === "shipping" ? validateAddress(b.address) : null;
  if (delivery === "pickup" && b.address)
    fail("A pickup order does not need an address.");
  const fingerprint = await hash({
    session: session.session_id,
    campaign: session.id,
    body: { ...b, requestId: undefined },
  });
  const previous = async () => {
    const o = await first(
      db,
      "SELECT o.fingerprint,g.session_id FROM orders o JOIN guest_orders g ON g.order_id=o.id WHERE o.id=?",
      id,
    );
    if (
      o &&
      (o.fingerprint !== fingerprint || o.session_id !== session.session_id)
    )
      fail("This request identifier was already used.", 409);
    return o;
  };
  if (await previous()) return { orderId: id, replayed: true };
  const q = await guestQuote(db, session, b);
  if (int(b.expectedTotal, 1, 50000) !== q.total)
    fail(
      "The order total changed. Review the latest total before submitting.",
      409,
    );
  const settings = await first(
    db,
    "SELECT cashtag FROM settings WHERE id='main'",
  );
  if (method === "cashapp" && !settings?.cashtag)
    fail("Cash App is not available.");
  const time = Date.now(),
    code = "GEAR-" + id.slice(0, 12).toUpperCase(),
    expires = time + session.reservation_hours * 3600000;
  const packet = JSON.stringify(
    q.lines.map((l: Row) => ({
      ...l,
      item_id: uid(),
      stock_qty: q.quantities.get(l.key),
    })),
  );
  const cost =
    q.shipping > 0 || q.lines.some((l: Row) => l.cost == null)
      ? null
      : q.lines.reduce((n: number, l: Row) => n + l.cost * l.qty, 0);
  const statements = [
    ...sessionStatements(db, session),
    guard(
      db,
      "(SELECT COUNT(*) FROM guest_orders g JOIN orders o ON o.id=g.order_id WHERE g.session_id=? AND o.status='pending')<3",
      session.session_id,
    ),
    guard(
      db,
      "(SELECT COUNT(*) FROM guest_orders WHERE campaign_id=? AND created_at>?)<1000",
      session.id,
      time - 86400000,
    ),
    guard(
      db,
      `NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN products p ON p.id=json_extract(j.value,'$.product_id') LEFT JOIN product_details d ON d.product_id=p.id LEFT JOIN product_variants v ON v.id=json_extract(j.value,'$.option_id') AND v.product_id=p.id
   WHERE p.id IS NULL OR p.category<>'Gear' OR p.active<>1 OR COALESCE(d.archived,0)<>0 OR p.version<>json_extract(j.value,'$.product_version') OR
   (json_extract(j.value,'$.option_id')='' AND (EXISTS(SELECT 1 FROM product_variants x WHERE x.product_id=p.id) OR (p.preorder=0 AND p.stock<json_extract(j.value,'$.stock_qty')))) OR
   (json_extract(j.value,'$.option_id')<>'' AND (v.id IS NULL OR v.active<>1 OR v.version<>json_extract(j.value,'$.option_version') OR (v.preorder=0 AND v.stock<json_extract(j.value,'$.stock_qty')))))`,
      packet,
    ),
    guard(
      db,
      `NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN guest_campaign_items ci ON ci.campaign_id=? AND ci.product_id=json_extract(j.value,'$.product_id') AND ci.option_id=json_extract(j.value,'$.option_id')
   LEFT JOIN gear_delivery d ON d.product_id=ci.product_id AND d.option_id=ci.option_id
   WHERE ci.product_id IS NULL OR COALESCE(d.version,-1)<>json_extract(j.value,'$.delivery_version') OR ci.quantity_limit<json_extract(j.value,'$.stock_qty')+COALESCE((SELECT SUM(i.remaining_qty) FROM guest_orders g JOIN orders o ON o.id=g.order_id JOIN item_balances i ON i.order_id=o.id WHERE g.campaign_id=ci.campaign_id AND o.status<>'void' AND i.product_id=ci.product_id AND COALESCE(i.variant_id,'')=ci.option_id),0))`,
      packet,
      session.id,
    ),
    stmt(
      db,
      `UPDATE products SET stock=stock-(SELECT SUM(json_extract(value,'$.qty')) FROM json_each(?) WHERE json_extract(value,'$.product_id')=products.id AND json_extract(value,'$.option_id')='' AND json_extract(value,'$.preorder')=0) WHERE id IN(SELECT json_extract(value,'$.product_id') FROM json_each(?) WHERE json_extract(value,'$.option_id')='' AND json_extract(value,'$.preorder')=0)`,
      packet,
      packet,
    ),
    stmt(
      db,
      `UPDATE product_variants SET stock=stock-(SELECT SUM(json_extract(value,'$.qty')) FROM json_each(?) WHERE json_extract(value,'$.option_id')=product_variants.id AND json_extract(value,'$.preorder')=0) WHERE id IN(SELECT json_extract(value,'$.option_id') FROM json_each(?) WHERE json_extract(value,'$.option_id')<>'' AND json_extract(value,'$.preorder')=0)`,
      packet,
      packet,
    ),
    stmt(
      db,
      "INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,cost,status,created_at) VALUES(?,?,?,NULL,?,?,?,?,?,'pending',?)",
      id,
      code,
      fingerprint,
      name,
      method,
      q.total,
      q.tax,
      cost,
      time,
    ),
    stmt(
      db,
      "INSERT INTO order_funding(order_id,credit_used,tab_added,cash_due) VALUES(?,0,0,?)",
      id,
      q.total,
    ),
    stmt(
      db,
      `INSERT INTO order_items(id,order_id,product_id,name,qty,price,cost,tax_bp,preorder) SELECT json_extract(value,'$.item_id'),?,json_extract(value,'$.product_id'),json_extract(value,'$.name'),json_extract(value,'$.qty'),json_extract(value,'$.price'),json_extract(value,'$.cost'),json_extract(value,'$.tax_bp'),json_extract(value,'$.preorder') FROM json_each(?)`,
      id,
      packet,
    ),
    stmt(
      db,
      `INSERT INTO order_item_details(item_id,variant_id,variant_label,personalization,fulfillment,updated_at) SELECT json_extract(value,'$.item_id'),NULLIF(json_extract(value,'$.option_id'),''),json_extract(value,'$.option_label'),json_extract(value,'$.personalization'),CASE WHEN json_extract(value,'$.preorder')=1 THEN 'awaiting_stock' ELSE 'ready' END,? FROM json_each(?)`,
      time,
      packet,
    ),
    ...(q.shipping
      ? [
          stmt(
            db,
            "INSERT INTO custom_order_items(id,order_id,name,category,qty,price,cost,tax_bp) VALUES(?,?,'Shipping','Gear',1,?,NULL,?)",
            uid(),
            id,
            q.shipping,
            session.shipping_tax_bp,
          ),
        ]
      : []),
    stmt(
      db,
      "INSERT INTO payments(id,fingerprint,order_id,purpose,method,amount,status,created_at) VALUES(?,?,?,'purchase',?,?,'pending',?)",
      id,
      fingerprint,
      id,
      method,
      q.total,
      time,
    ),
    stmt(
      db,
      "INSERT INTO guest_orders(order_id,campaign_id,session_id,email,receipt_hash,delivery,address,shipping_amount,reservation_expires,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id,
      session.id,
      session.session_id,
      email,
      await receiptHash(receiptSecret),
      delivery,
      address ? JSON.stringify(address) : null,
      q.shipping,
      expires,
      time,
      time,
    ),
    stmt(
      db,
      "INSERT INTO guest_order_events(id,order_id,actor,kind,note,created_at) VALUES(?,?,'guest','submitted','Payment reported; awaiting administrator confirmation.',?)",
      uid(),
      id,
      time,
    ),
    audit(db, "guest", "guest_order_submitted", id, {
      campaign: session.id,
      delivery,
      total: q.total,
      shipping: q.shipping,
      reservationExpires: expires,
    }),
  ];
  try {
    await batchAtomic(db, statements);
  } catch (e) {
    if (!(await previous())) throw e;
    return { orderId: id, replayed: true };
  }
  return { orderId: id, replayed: false };
}

export async function guestReceipt(db: DB, id: string) {
  const order = await first(
    db,
    `SELECT o.code,o.method,o.status payment_status,o.total,o.tax,o.original_total,o.adjusted_total,(SELECT COALESCE(SUM(a.external_refund+a.credit_returned),0) FROM transaction_adjustments a WHERE a.order_id=o.id) refunded,g.delivery,g.state,g.shipping_amount,g.reservation_expires,g.carrier,g.tracking,g.created_at,c.pickup_note
  FROM guest_orders g JOIN order_balances o ON o.id=g.order_id JOIN guest_campaigns c ON c.id=g.campaign_id WHERE g.order_id=?`,
    id,
  );
  if (!order) fail("Order not found.", 404);
  const items = await rows(
    db,
    "SELECT name,variant_label,personalization,remaining_qty qty,price,preorder,fulfillment FROM item_balances WHERE order_id=? ORDER BY name,id",
    id,
  );
  return { order, items };
}

// Expiry reverses only still-pending reservations. Confirmation and expiry share
// atomic state guards, so a paid order can never lose its stock to this job.
export async function expireGuestOrders(db: DB, limit = 3) {
  const candidates = await rows(
    db,
    "SELECT g.order_id FROM guest_orders g JOIN orders o ON o.id=g.order_id WHERE g.state='payment_pending' AND o.status='pending' AND g.reservation_expires<? ORDER BY g.reservation_expires LIMIT ?",
    Date.now(),
    limit,
  );
  for (const candidate of candidates) {
    const o = await first(
        db,
        "SELECT * FROM order_balances WHERE id=?",
        candidate.order_id,
      ),
      items = await rows(
        db,
        "SELECT * FROM item_balances WHERE order_id=? AND remaining_qty>0",
        candidate.order_id,
      );
    if (!o || o.status !== "pending" || !o.total) continue;
    const id = uid(),
      packet = JSON.stringify(items),
      now = Date.now();
    try {
      await batchAtomic(db, [
        guard(
          db,
          "EXISTS(SELECT 1 FROM order_balances o JOIN guest_orders g ON g.order_id=o.id WHERE o.id=? AND o.status='pending' AND o.revision=? AND g.state='payment_pending' AND g.reservation_expires<?)",
          o.id,
          o.revision,
          now,
        ),
        stmt(
          db,
          "INSERT INTO transaction_adjustments(id,order_id,actor,reason,created_at,total,tax,cost,pending_reduced,refund_method) VALUES(?,?,'system','Unconfirmed guest reservation expired.',?,?,?,?,?,'none')",
          id,
          o.id,
          now,
          o.total,
          o.tax,
          o.cost,
          o.total,
        ),
        stmt(
          db,
          `INSERT INTO transaction_adjustment_items(adjustment_id,item_id,qty,restock) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.remaining_qty'),CASE WHEN json_extract(value,'$.custom')=0 AND json_extract(value,'$.preorder')=0 THEN 1 ELSE 0 END FROM json_each(?)`,
          id,
          packet,
        ),
        stmt(
          db,
          `UPDATE products SET stock=stock+(SELECT SUM(json_extract(value,'$.remaining_qty')) FROM json_each(?) WHERE json_extract(value,'$.product_id')=products.id AND json_extract(value,'$.variant_id') IS NULL AND json_extract(value,'$.preorder')=0 AND json_extract(value,'$.custom')=0),version=version+1 WHERE id IN(SELECT json_extract(value,'$.product_id') FROM json_each(?) WHERE json_extract(value,'$.variant_id') IS NULL AND json_extract(value,'$.preorder')=0 AND json_extract(value,'$.custom')=0)`,
          packet,
          packet,
        ),
        stmt(
          db,
          `UPDATE product_variants SET stock=stock+(SELECT SUM(json_extract(value,'$.remaining_qty')) FROM json_each(?) WHERE json_extract(value,'$.variant_id')=product_variants.id AND json_extract(value,'$.preorder')=0),version=version+1 WHERE id IN(SELECT json_extract(value,'$.variant_id') FROM json_each(?) WHERE json_extract(value,'$.variant_id') IS NOT NULL AND json_extract(value,'$.preorder')=0)`,
          packet,
          packet,
        ),
        stmt(
          db,
          "UPDATE payments SET status='rejected' WHERE order_id=? AND status='pending'",
          o.id,
        ),
        stmt(db, "UPDATE orders SET status='void' WHERE id=?", o.id),
        stmt(
          db,
          "UPDATE guest_orders SET state='expired',version=version+1,updated_at=? WHERE order_id=?",
          now,
          o.id,
        ),
        stmt(
          db,
          "INSERT INTO guest_order_events(id,order_id,actor,kind,note,created_at) VALUES(?,?,'system','expired','Unconfirmed reservation expired. Reserved stock returned.',?)",
          uid(),
          o.id,
          now,
        ),
        audit(db, "system", "guest_reservation_expired", o.id, {
          adjustmentId: id,
          total: o.total,
        }),
      ]);
    } catch (e) {
      if (
        (await first(db, "SELECT status FROM orders WHERE id=?", o.id))
          ?.status === "pending"
      )
        throw e;
    }
  }
  return candidates.length;
}
