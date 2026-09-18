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
  batchAtomic,
  sessionGuard,
} from "./core";
import { accessFor, canShop } from "./access";
import { ledger, cashReference } from "./balances";
import { EarningPlan } from "./earning";

// Guest mode is set only by the administrator action, never by a request field.
export async function placeOrder(
  db: DB,
  m: Row,
  b: Row,
  settings: Row,
  tokenHash?: string,
  guest = false,
  adminActor?: Row,
) {
  const actor = adminActor?.id || m.id,
    buyer = m.id,
    managed = guest || !!adminActor,
    id = reqId(b.id),
    method = str(b.method, 20);
  if (
    !["cash", "cashapp", "tab", "credit"].includes(method) ||
    (guest && !["cash", "cashapp"].includes(method))
  )
    fail("Choose an available payment method.");
  if (managed && (adminActor || m).role !== "admin")
    fail("Administrator access is required.", 403);
  const payer = guest ? str(b.payer || "Guest", 100) : m.name,
    unsettled = managed && b.unsettled === true;
  const entryReason = str(b.reason || "", 300),
    overrideReason = unsettled ? entryReason : "";
  if (
    unsettled &&
    (overrideReason.length < 5 || payer.toLowerCase() === "guest")
  )
    fail("An unsettled guest sale needs a guest name and an override reason.");
  if (
    managed &&
    !unsettled &&
    ["cash", "cashapp"].includes(method) &&
    b.confirmed !== true
  )
    fail(
      "Confirm receipt of the guest payment, or explicitly leave this sale unsettled.",
    );
  const reference =
    managed && !unsettled && method === "cashapp"
      ? str(b.reference || "", 100).toLowerCase()
      : "";
  if (managed && !unsettled && method === "cashapp" && !reference)
    fail("Enter the Cash App transaction ID.");
  if (
    !Array.isArray(b.items) ||
    !b.items.length ||
    b.items.length > 30 ||
    b.items.some(
      (v: unknown) => !v || typeof v !== "object" || Array.isArray(v),
    )
  )
    fail("Select between 1 and 30 valid sale lines.");
  const items = b.items
    .map((v: Row) => {
      const base = { qty: int(v.qty, 1, 30), price: int(v.price, 1, 100000) };
      if (managed && v.custom === true) {
        const name = str(v.name, 100),
          category = str(v.category || "Snacks", 20);
        if (!name || !["Snacks", "Gear"].includes(category))
          fail("Give each custom sale a name and shop.");
        return {
          ...base,
          custom: true,
          name,
          category,
          taxBp: int(v.taxBp ?? 0, 0, 3000),
          cost: v.cost == null ? null : int(v.cost, 0, 100000),
        };
      }
      return {
        ...base,
        id: str(v.id, 80),
        variantId: v.variantId ? str(v.variantId, 80) : "",
        personalization: v.personalization ? str(v.personalization, 80) : "",
      };
    })
    .sort((a: Row, c: Row) =>
      JSON.stringify(a).localeCompare(JSON.stringify(c)),
    );
  const key = (i: Row) =>
    JSON.stringify([
      i.id || i.name,
      i.variantId || "",
      i.personalization || "",
    ]);
  if (new Set(items.map(key)).size !== items.length)
    fail("Combine duplicate products and options in the bag.");
  const requestedCredit = int(b.creditAmount ?? 0, 0, 50000);
  const fp = await hash({
    actor,
    buyer: guest ? null : buyer,
    guest,
    payer,
    method,
    items,
    requestedCredit,
    unsettled,
    overrideReason,
    entryReason,
    reference,
  });
  const duplicate = async () => {
    const old = await first(db, "SELECT * FROM orders WHERE id=?", id);
    if (old && old.fingerprint !== fp)
      fail("This request identifier has already been used.", 409);
    return old;
  };
  const old = await duplicate();
  if (old)
    return {
      order: await first(db, "SELECT * FROM order_balances WHERE id=?", id),
      replayed: true,
    };
  if (!settings.enabled && !managed)
    fail(
      "The shop is paused. An administrator can reopen it from Shop controls.",
    );
  if (method === "cashapp" && !settings.cashtag)
    fail("Cash App is not configured yet.");
  const access = await accessFor(db, m as any);
  const ps = await rows(
    db,
    "SELECT p.*,d.archived,d.personalization_label,d.personalization_required,d.personalization_max FROM products p LEFT JOIN product_details d ON d.product_id=p.id",
  );
  const variants = await rows(db, "SELECT * FROM product_variants");
  let total = 0,
    tax = 0,
    cost: number | null = 0;
  const quantities = new Map<string, number>();
  const lines = items.map((item: Row): Row => {
    let line: Row;
    if (item.custom) {
      if (!guest && !canShop(m as any, access, item.category))
        fail("Your account cannot purchase from this shop.", 403);
      line = {
        ...item,
        preorder: 0,
        tax_bp: item.taxBp,
        personalization: "",
        variant: null,
      };
    } else {
      const p = ps.find((p) => p.id === item.id);
      if (!p || !p.active || p.archived || p.tax_bp === null)
        fail("One of these products is not ready for sale.");
      if (!canShop(m as any, access, p.category))
        fail("Your account cannot purchase from this shop.", 403);
      const options = variants.filter((v) => v.product_id === p.id),
        variant = item.variantId
          ? options.find((v) => v.id === item.variantId && v.active)
          : null;
      if (item.variantId && !variant)
        fail("This product option is unavailable.");
      if (options.length && !variant)
        fail("Select a size or color on the product page.");
      if (
        item.personalization &&
        (!p.personalization_label || p.category !== "Gear")
      )
        fail("This product does not accept personalization.");
      if (p.personalization_required && !item.personalization)
        fail(
          "Enter " +
            (p.personalization_label || "personalization") +
            " for " +
            p.name +
            ".",
        );
      if (
        (item.personalization || "").length > (p.personalization_max || 30) ||
        /[\x00-\x1f\x7f]/.test(item.personalization || "")
      )
        fail("Review the personalization for " + p.name + ".");
      const price = variant?.price ?? p.price,
        unitCost = variant?.cost ?? p.cost,
        preorder = variant ? variant.preorder : p.preorder,
        stock = variant ? variant.stock : p.stock;
      if (price === null || price !== item.price)
        fail("A price changed. Refresh your bag before checking out.", 409);
      const stockKey = variant ? "v:" + variant.id : "p:" + p.id,
        qty = (quantities.get(stockKey) || 0) + item.qty;
      quantities.set(stockKey, qty);
      if (!preorder && stock < qty)
        fail(p.name + " has insufficient stock.", 409);
      line = {
        ...p,
        price,
        cost: unitCost,
        preorder,
        qty: item.qty,
        variant,
        personalization: item.personalization || "",
        custom: false,
      };
    }
    total += line.price * line.qty;
    tax += Math.round(
      (line.price * line.qty * line.tax_bp) / (10000 + line.tax_bp),
    );
    cost =
      cost === null || line.cost === null ? null : cost + line.cost * line.qty;
    return line;
  });
  const hasGear = lines.some((p) => p.category === "Gear"),
    hasSnacks = lines.some((p) => p.category !== "Gear");
  if (!guest && hasGear && hasSnacks)
    fail(
      "Check out snacks and unit gear separately. Your other items will stay in your bag.",
    );
  if (!guest && hasSnacks && !["tab", "credit"].includes(method))
    fail(
      "Snack purchases go on your tab or use confirmed credit. Cash and Cash App are available when settling your tab.",
    );
  if (hasGear && method === "tab") fail("Unit gear must be paid upfront.");
  if (total > 50000) fail("Keep each purchase under $500.");
  const creditUsed = method === "credit" ? total : requestedCredit;
  if ((guest && creditUsed) || creditUsed > total)
    fail("Choose a valid credit amount.");
  const remainder = total - creditUsed,
    tabAdded = method === "tab" ? remainder : 0,
    cashDue = ["cash", "cashapp"].includes(method) ? remainder : 0;
  if (["cash", "cashapp"].includes(method) && cashDue === 0)
    fail("Select credit when it covers the full purchase.");
  const time = Date.now(),
    code = (guest ? "GS-" : "SB-") + id.slice(0, 12).toUpperCase();
  const status =
    tabAdded > 0
      ? "tab"
      : cashDue > 0 && (!managed || unsettled)
        ? "pending"
        : "paid";
  if (
    !guest &&
    status === "pending" &&
    (await first(
      db,
      "SELECT COUNT(*) n FROM orders WHERE member_id=? AND status='pending'",
      buyer,
    ))!.n >= 20
  )
    fail(
      "Ask an administrator to review your pending payments before ordering again.",
      429,
    );
  const packet = JSON.stringify(
    lines
      .filter((p) => !p.custom)
      .map((p) => ({
        ...p,
        itemId: uid(),
        variantId: p.variant?.id || "",
        variantVersion: p.variant?.version ?? 0,
        variantLabel: p.variant?.label || "",
        stockQty: quantities.get(p.variant ? "v:" + p.variant.id : "p:" + p.id),
      })),
  );
  const earning = guest ? null : await EarningPlan.load(db, buyer, "order:" + id, "purchase", time);
  const rewardCreditUsed = earning?.spendCredit(creditUsed) || 0;
  earning?.purchase({ orderId: id, gross: total, merchandise: total - tax,
    creditUsed, rewardCreditUsed, tabAdded, cashDue, cashConfirmed: managed && !unsettled });
  const statements = [...sessionGuard(db, actor, tokenHash, managed), ...(earning?.prefixes || [])];
  if (managed)
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM members WHERE id=? AND role='admin' AND active=1)",
        actor,
      ),
    );
  if (!guest)
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM members m LEFT JOIN member_access a ON a.member_id=m.id WHERE m.id=? AND m.active=1 AND (?=0 OR m.role='admin' OR COALESCE(a.snacks,1)=1) AND (?=0 OR m.role='admin' OR COALESCE(a.gear,1)=1))",
        buyer,
        hasSnacks ? 1 : 0,
        hasGear ? 1 : 0,
      ),
    );
  if (!managed)
    statements.push(
      guard(db, "EXISTS(SELECT 1 FROM settings WHERE id='main' AND enabled=1)"),
    );
  statements.push(
    guard(
      db,
      "NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN products p ON p.id=json_extract(j.value,'$.id') LEFT JOIN product_details d ON d.product_id=p.id WHERE p.id IS NULL OR p.active<>1 OR p.version<>json_extract(j.value,'$.version') OR COALESCE(d.archived,0)<>0 OR (json_extract(j.value,'$.variantId')='' AND (EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id) OR (p.preorder=0 AND p.stock<json_extract(j.value,'$.stockQty')))))",
      packet,
    ),
    guard(
      db,
      "NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN product_variants v ON v.id=json_extract(j.value,'$.variantId') AND v.product_id=json_extract(j.value,'$.id') WHERE json_extract(j.value,'$.variantId')<>'' AND (v.id IS NULL OR v.active<>1 OR v.version<>json_extract(j.value,'$.variantVersion') OR (v.preorder=0 AND v.stock<json_extract(j.value,'$.stockQty'))))",
      packet,
    ),
    stmt(
      db,
      "UPDATE products SET stock=stock-(SELECT SUM(json_extract(value,'$.qty')) FROM json_each(?) WHERE json_extract(value,'$.id')=products.id AND json_extract(value,'$.variantId')='' AND json_extract(value,'$.preorder')=0) WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?) WHERE json_extract(value,'$.variantId')='' AND json_extract(value,'$.preorder')=0)",
      packet,
      packet,
    ),
    stmt(
      db,
      "UPDATE product_variants SET stock=stock-(SELECT SUM(json_extract(value,'$.qty')) FROM json_each(?) WHERE json_extract(value,'$.variantId')=product_variants.id AND json_extract(value,'$.preorder')=0) WHERE id IN(SELECT json_extract(value,'$.variantId') FROM json_each(?) WHERE json_extract(value,'$.variantId')<>'' AND json_extract(value,'$.preorder')=0)",
      packet,
      packet,
    ),
  );
  if (!guest && status === "pending")
    statements.push(
      guard(
        db,
        "(SELECT COUNT(*) FROM orders WHERE member_id=? AND status='pending')<20",
        buyer,
      ),
    );
  if (tabAdded > 0)
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM members m LEFT JOIN member_controls c ON c.member_id=m.id WHERE m.id=? AND m.active=1 AND m.debt+?<=MIN(COALESCE(c.tab_limit,3000),3000))",
        buyer,
        tabAdded,
      ),
      stmt(
        db,
        "UPDATE members SET due_since=CASE WHEN debt=0 THEN ? ELSE due_since END,debt=debt+? WHERE id=?",
        time,
        tabAdded,
        buyer,
      ),
    );
  if (creditUsed > 0)
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND credit>=?)",
        buyer,
        creditUsed,
      ),
      stmt(
        db,
        "UPDATE members SET credit=credit-? WHERE id=?",
        creditUsed,
        buyer,
      ),
    );
  statements.push(
    stmt(
      db,
      "INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,cost,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id,
      code,
      fp,
      guest ? null : buyer,
      payer,
      method,
      total,
      tax,
      cost,
      status,
      time,
    ),
    stmt(
      db,
      "INSERT INTO order_funding(order_id,credit_used,tab_added,cash_due) VALUES(?,?,?,?)",
      id,
      creditUsed,
      tabAdded,
      cashDue,
    ),
  );
  statements.push(
    stmt(
      db,
      "INSERT INTO order_items(id,order_id,product_id,name,qty,price,cost,tax_bp,preorder) SELECT json_extract(value,'$.itemId'),?,json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.qty'),json_extract(value,'$.price'),json_extract(value,'$.cost'),json_extract(value,'$.tax_bp'),json_extract(value,'$.preorder') FROM json_each(?)",
      id,
      packet,
    ),
    stmt(
      db,
      "INSERT INTO order_item_details(item_id,variant_id,variant_label,personalization,fulfillment,updated_at) SELECT json_extract(value,'$.itemId'),NULLIF(json_extract(value,'$.variantId'),''),json_extract(value,'$.variantLabel'),json_extract(value,'$.personalization'),CASE WHEN json_extract(value,'$.preorder')=1 THEN 'awaiting_stock' ELSE 'ready' END,? FROM json_each(?) WHERE json_extract(value,'$.category')='Gear'",
      time,
      packet,
    ),
  );
  for (const line of lines.filter((p) => p.custom))
    statements.push(
      stmt(
        db,
        "INSERT INTO custom_order_items(id,order_id,name,category,qty,price,cost,tax_bp) VALUES(?,?,?,?,?,?,?,?)",
        uid(),
        id,
        line.name,
        line.category,
        line.qty,
        line.price,
        line.cost,
        line.tax_bp,
      ),
    );
  if (cashDue > 0) {
    const confirmed = managed && !unsettled,
      receipt = confirmed
        ? method === "cash"
          ? cashReference()
          : reference
        : null;
    statements.push(
      stmt(
        db,
        "INSERT INTO payments(id,fingerprint,order_id,member_id,purpose,method,amount,status,reference,verified_by,created_at,verified_at) VALUES(?,?,?,?,'purchase',?,?,?,?,?,?,?)",
        id,
        fp,
        id,
        guest ? null : buyer,
        method,
        cashDue,
        confirmed ? "verified" : "pending",
        receipt,
        confirmed ? actor : null,
        time,
        confirmed ? time : null,
      ),
    );
    if (confirmed)
      statements.push(
        audit(db, actor, "payment_verified", id, {
          reference: receipt,
          amount: cashDue,
          method,
          guest,
          onBehalf: !!adminActor,
        }),
      );
  }
  if (!guest && (creditUsed || tabAdded))
    statements.push(
      ledger(
        db,
        buyer,
        actor,
        "purchase",
        tabAdded,
        -creditUsed,
        "Purchase " + code,
        id,
      ),
    );
  if (earning) statements.push(...earning.finish());
  statements.push(
    audit(db, actor, guest ? "guest_sale" : "consumption", id, {
      items,
      total,
      method,
      creditUsed,
      tabAdded,
      cashDue,
      unsettled,
      overrideReason,
      onBehalf: !!adminActor,
      entryReason,
    }),
  );
  try {
    await batchAtomic(db, statements);
  } catch (e) {
    const retry = await duplicate();
    if (retry)
      return {
        order: await first(db, "SELECT * FROM order_balances WHERE id=?", id),
        replayed: true,
      };
    throw e;
  }
  return {
    order: await first(db, "SELECT * FROM order_balances WHERE id=?", id),
  };
}
