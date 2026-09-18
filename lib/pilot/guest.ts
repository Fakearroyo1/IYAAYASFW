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
} from "./core";
import { operation, noteText } from "./operation";
import { codeHash, randomCode } from "../guest/common";

export const GUEST_ACTIONS = [
  "guestSettings",
  "guestCampaign",
  "guestCode",
  "gearDelivery",
  "guestFulfill",
  "guestExtend",
];
export async function guestAdmin(db: DB, q: Row) {
  const settings = await first(
    db,
    "SELECT * FROM guest_settings WHERE id='main'",
  );
  const campaigns = await rows(
    db,
    `SELECT id,name,description,starts_at,ends_at,active,code_version,version,
 reservation_hours,shipping_cap,free_shipping_threshold,shipping_tax_bp,pickup_note,created_at,updated_at,
 code_hash IS NOT NULL code_configured FROM guest_campaigns ORDER BY created_at DESC LIMIT 100`,
  );
  const items = await rows(
    db,
    "SELECT * FROM guest_campaign_items ORDER BY campaign_id,product_id,option_id",
  );
  const deliveries = await rows(db, "SELECT * FROM gear_delivery");
  const catalog = await rows(
    db,
    `SELECT p.id product_id,p.name,p.active,p.preorder,p.stock,p.price,
 COALESCE(v.id,'') option_id,COALESCE(v.label,'Standard') option_label,
 COALESCE(v.stock,p.stock) option_stock,COALESCE(v.price,p.price) option_price,COALESCE(v.active,p.active) option_active
 FROM products p LEFT JOIN product_variants v ON v.product_id=p.id LEFT JOIN product_details d ON d.product_id=p.id
 WHERE p.category='Gear' AND COALESCE(d.archived,0)=0 ORDER BY p.name,v.label LIMIT 300`,
  );
  const offset = int(Number(q.offset || 0), 0, 100000);
  const orders = await rows(
    db,
    `SELECT g.order_id,g.campaign_id,g.email,g.delivery,g.address,g.shipping_amount,g.state,g.reservation_expires,
 g.carrier,g.tracking,g.version,g.created_at,c.name campaign_name,o.code,o.payer,o.total,o.status payment_status
 FROM guest_orders g JOIN order_balances o ON o.id=g.order_id JOIN guest_campaigns c ON c.id=g.campaign_id
 WHERE (?='' OR g.state=?) ORDER BY g.created_at DESC,g.order_id LIMIT 51 OFFSET ?`,
    q.state || "",
    q.state || "",
    offset,
  );
  const detail = q.orderId
    ? {
        items: await rows(
          db,
          "SELECT * FROM item_balances WHERE order_id=?",
          str(q.orderId, 80),
        ),
        events: await rows(
          db,
          "SELECT * FROM guest_order_events WHERE order_id=? ORDER BY created_at DESC LIMIT 100",
          str(q.orderId, 80),
        ),
      }
    : null;
  return {
    settings,
    campaigns,
    items,
    deliveries,
    catalog,
    orders: orders.slice(0, 50),
    more: orders.length > 50,
    detail,
  };
}
export async function mutateGuest(db: DB, m: Row, b: Row, tokenHash?: string) {
  const op = await operation(db, m, b, true, tokenHash);
  if (op.replayed) return { ok: true, replayed: true };
  const now = Date.now();
  let statements: D1PreparedStatement[] = [],
    result: Row = { ok: true };
  if (b.action === "guestSettings") {
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM guest_settings WHERE id='main' AND version=?)",
        int(b.version),
      ),
      stmt(
        db,
        "UPDATE guest_settings SET enabled=?,version=version+1 WHERE id='main'",
        b.enabled === true ? 1 : 0,
      ),
      audit(db, m.id, "guest_store_setting", "main", {
        enabled: b.enabled === true,
        reason: noteText(b.reason),
      }),
    ];
  } else if (b.action === "guestCampaign") {
    const id = b.id ? str(b.id, 80) : uid(),
      old = await first(db, "SELECT * FROM guest_campaigns WHERE id=?", id),
      name = noteText(b.name, 100, 2),
      description = str(b.description || "", 1500),
      start = int(b.startsAt, 0, 9999999999999),
      end = int(b.endsAt, 0, 9999999999999);
    if (end <= start || end - start > 366 * 86400000)
      fail("Choose a campaign window of at most one year.");
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100)
      fail("Choose 1–100 gear options.");
    const seen = new Set<string>(),
      items = [];
    for (const input of b.items) {
      const productId = str(input.productId, 80),
        optionId = str(input.optionId || "", 80),
        key = productId + ":" + optionId;
      if (seen.has(key)) fail("Each option can appear once.");
      seen.add(key);
      items.push({ productId, optionId, limit: int(input.limit, 1, 10000) });
    }
    const packet = JSON.stringify(items);
    statements.push(
      old
        ? guard(
            db,
            "EXISTS(SELECT 1 FROM guest_campaigns WHERE id=? AND version=?)",
            id,
            int(b.version),
          )
        : guard(db, "NOT EXISTS(SELECT 1 FROM guest_campaigns WHERE id=?)", id),
    );
    statements.push(
      guard(
        db,
        `NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN products p ON p.id=json_extract(j.value,'$.productId') LEFT JOIN product_variants v ON v.id=json_extract(j.value,'$.optionId') AND v.product_id=p.id
   WHERE p.id IS NULL OR p.category<>'Gear' OR (json_extract(j.value,'$.optionId')<>'' AND v.id IS NULL) OR (json_extract(j.value,'$.optionId')='' AND EXISTS(SELECT 1 FROM product_variants x WHERE x.product_id=p.id)))`,
        packet,
      ),
    );
    statements.push(
      stmt(
        db,
        `INSERT INTO guest_campaigns(id,name,description,starts_at,ends_at,active,reservation_hours,shipping_cap,free_shipping_threshold,shipping_tax_bp,pickup_note,actor,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=excluded.active,reservation_hours=excluded.reservation_hours,shipping_cap=excluded.shipping_cap,free_shipping_threshold=excluded.free_shipping_threshold,shipping_tax_bp=excluded.shipping_tax_bp,pickup_note=excluded.pickup_note,version=guest_campaigns.version+1,updated_at=excluded.updated_at`,
        id,
        name,
        description,
        start,
        end,
        b.active === true ? 1 : 0,
        int(b.reservationHours || 24, 1, 72),
        b.shippingCap == null ? null : int(b.shippingCap, 0, 100000),
        b.freeShippingThreshold == null
          ? null
          : int(b.freeShippingThreshold, 1, 100000),
        int(b.shippingTaxBp || 0, 0, 3000),
        str(b.pickupNote || "", 500),
        m.id,
        now,
        now,
      ),
      stmt(db, "DELETE FROM guest_campaign_items WHERE campaign_id=?", id),
      stmt(
        db,
        `INSERT INTO guest_campaign_items(campaign_id,product_id,option_id,quantity_limit) SELECT ?,json_extract(value,'$.productId'),json_extract(value,'$.optionId'),json_extract(value,'$.limit') FROM json_each(?)`,
        id,
        packet,
      ),
      audit(db, m.id, "guest_campaign_saved", id, {
        name,
        active: !!b.active,
        items,
      }),
    );
    result.id = id;
  } else if (b.action === "guestCode") {
    const id = str(b.id, 80),
      code = b.revoke ? null : randomCode();
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM guest_campaigns WHERE id=? AND version=?)",
        id,
        int(b.version),
      ),
      stmt(
        db,
        "UPDATE guest_campaigns SET code_hash=?,code_version=code_version+1,version=version+1,updated_at=? WHERE id=?",
        code ? await codeHash(code) : null,
        now,
        id,
      ),
      audit(
        db,
        m.id,
        b.revoke ? "guest_code_revoked" : "guest_code_rotated",
        id,
        { reason: noteText(b.reason) },
      ),
    ];
    result = { ok: true, code }; // The code is returned once; never logged or stored in plaintext.
  } else if (b.action === "gearDelivery") {
    const productId = str(b.productId, 80),
      optionId = str(b.optionId || "", 80),
      version = int(b.version, -1),
      pickup = b.pickup === true ? 1 : 0,
      shipping = b.shipping === true ? 1 : 0;
    if (!pickup && !shipping) fail("Enable pickup or shipping.");
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM products p WHERE p.id=? AND p.category='Gear' AND (?='' OR EXISTS(SELECT 1 FROM product_variants v WHERE v.id=? AND v.product_id=p.id)))",
        productId,
        optionId,
        optionId,
      ),
      guard(
        db,
        "COALESCE((SELECT version FROM gear_delivery WHERE product_id=? AND option_id=?),-1)=?",
        productId,
        optionId,
        version,
      ),
      stmt(
        db,
        `INSERT INTO gear_delivery(product_id,option_id,pickup,shipping,first_charge,additional_charge) VALUES(?,?,?,?,?,?) ON CONFLICT(product_id,option_id) DO UPDATE SET pickup=excluded.pickup,shipping=excluded.shipping,first_charge=excluded.first_charge,additional_charge=excluded.additional_charge,version=gear_delivery.version+1`,
        productId,
        optionId,
        pickup,
        shipping,
        int(b.firstCharge, 0, 50000),
        int(b.additionalCharge, 0, 50000),
      ),
      audit(db, m.id, "gear_delivery_saved", productId, {
        optionId,
        pickup,
        shipping,
        firstCharge: b.firstCharge,
        additionalCharge: b.additionalCharge,
      }),
    ];
  } else if (b.action === "guestFulfill" || b.action === "guestExtend") {
    const id = str(b.id, 80),
      old = await first(
        db,
        "SELECT g.*,o.status payment_status FROM guest_orders g JOIN orders o ON o.id=g.order_id WHERE g.order_id=?",
        id,
      );
    if (!old) fail("Order not found.", 404);
    const reason = noteText(b.reason),
      version = int(b.version);
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM guest_orders WHERE order_id=? AND version=?)",
        id,
        version,
      ),
    );
    if (b.action === "guestExtend") {
      const expires = int(b.expiresAt, now + 60000, now + 72 * 3600000);
      statements.push(
        guard(
          db,
          "EXISTS(SELECT 1 FROM orders WHERE id=? AND status='pending')",
          id,
        ),
        stmt(
          db,
          "UPDATE guest_orders SET reservation_expires=?,version=version+1,updated_at=? WHERE order_id=?",
          expires,
          now,
          id,
        ),
      );
    } else {
      const state = str(b.state, 30),
        allowed: Record<string, string[]> = {
          paid:
            old.delivery === "shipping" ? ["packing"] : ["ready_for_pickup"],
          packing: ["shipped"],
          shipped: ["completed"],
          ready_for_pickup: ["picked_up"],
          picked_up: ["completed"],
        };
      if (!(allowed[old.state] || []).includes(state))
        fail("Choose the next fulfillment step.");
      const carrier = str(b.carrier || old.carrier || "", 80),
        tracking = str(b.tracking || old.tracking || "", 120);
      if (state === "shipped" && (!carrier || !tracking))
        fail("Enter the carrier and tracking reference.");
      statements.push(
        guard(
          db,
          "EXISTS(SELECT 1 FROM orders WHERE id=? AND status='paid')",
          id,
        ),
        guard(
          db,
          "NOT EXISTS(SELECT 1 FROM item_balances WHERE order_id=? AND remaining_qty>0 AND preorder=1 AND fulfillment='awaiting_stock')",
          id,
        ),
        stmt(
          db,
          "UPDATE guest_orders SET state=?,carrier=?,tracking=?,version=version+1,updated_at=? WHERE order_id=?",
          state,
          carrier,
          tracking,
          now,
          id,
        ),
      );
      if (["shipped", "picked_up"].includes(state))
        statements.push(
          stmt(
            db,
            "UPDATE order_item_details SET fulfillment='fulfilled',updated_at=? WHERE item_id IN(SELECT id FROM item_balances WHERE order_id=? AND remaining_qty>0 AND custom=0)",
            now,
            id,
          ),
        );
    }
    statements.push(
      stmt(
        db,
        "INSERT INTO guest_order_events(id,order_id,actor,kind,note,created_at) VALUES(?,?,?,?,?,?)",
        uid(),
        id,
        m.id,
        b.action === "guestExtend" ? "extended" : b.state,
        reason,
        now,
      ),
      audit(db, m.id, b.action, id, { state: b.state || old.state, reason }),
    );
  } else fail("Choose a supported guest action.");
  await op.commit(statements);
  return result;
}
