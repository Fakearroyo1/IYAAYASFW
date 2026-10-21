import {
  type DB,
  type Row,
  fail,
  int,
  str,
  uid,
  first,
  rows,
  stmt,
  audit,
  guard,
} from "./core";
import { saveGear } from "./gear";
import { saveProduct } from "./product-editor";
import { canShop } from "./access";
const imagePath = (v: any) => {
  const image = str(v, 500);
  if (
    !/^\/(?:products\/|api\/product-images\?id=)[a-zA-Z0-9_./?=\-]+$/.test(
      image,
    )
  )
    fail("Upload a valid product image.");
  return image;
};
export async function catalogState(
  db: DB,
  m: Row,
  access: { snacks: number; gear: number },
) {
  const products = await rows(
    db,
    `SELECT p.*,COALESCE(d.description,'') description,COALESCE(d.images,'[]') images,COALESCE(d.personalization_label,'') personalization_label,COALESCE(d.personalization_required,0) personalization_required,COALESCE(d.personalization_max,30) personalization_max,COALESCE(d.pickup_note,'') pickup_note,COALESCE(d.archived,0) archived,COALESCE(d.version,0) details_version FROM products p LEFT JOIN product_details d ON d.product_id=p.id ORDER BY p.position,p.name`,
  );
  const variants = await rows(
    db,
    "SELECT * FROM product_variants ORDER BY rowid",
  );
  return products
    .filter(
      (p) =>
        m.role === "admin" ||
        (!p.archived && p.active && canShop(m as any, access, p.category)),
    )
    .map(({ cost, ...p }) => ({
      ...p,
      ...(m.role === "admin" ? { cost } : {}),
      images: JSON.parse(p.images),
      option_required: variants.some((v) => v.product_id === p.id),
      variants: variants
        .filter(
          (v) => v.product_id === p.id && (m.role === "admin" || v.active),
        )
        .map(({ cost, ...v }) => ({
          ...v,
          ...(m.role === "admin" ? { cost } : {}),
        })),
    }));
}
export async function extendedMutation(
  db: DB,
  m: Row,
  b: Row,
  atomic: (db: DB, s: D1PreparedStatement[]) => Promise<unknown>,
) {
  const actor = m.id;
  if (b.action === "saveProduct") return saveProduct(db, actor, b, atomic);
  if (b.action === "saveGear") return saveGear(db, actor, b, atomic);
  if (b.action === "gearStock") {
    const id = str(b.id, 80),
      stock = int(b.stock, 0, 100000),
      reason = str(b.reason, 200);
    const p = await first(
      db,
      "SELECT * FROM products WHERE id=? AND category='Gear'",
      id,
    );
    if (!p || !reason)
      fail("Choose a gear item and record the count adjustment reason.");
    await atomic(db, [
      guard(
        db,
        "EXISTS(SELECT 1 FROM products WHERE id=? AND version=? AND stock=?) AND NOT EXISTS(SELECT 1 FROM product_variants WHERE product_id=?)",
        id,
        int(b.version),
        int(b.previousStock),
        id,
      ),
      stmt(
        db,
        "UPDATE products SET stock=?,version=version+1 WHERE id=?",
        stock,
        id,
      ),
      audit(db, actor, "stock_adjusted", id, {
        before: p.stock,
        after: stock,
        reason,
      }),
    ]);
    return { ok: true };
  }
  if (b.action === "details") {
    const id = str(b.id, 80),
      p = await first(db, "SELECT * FROM products WHERE id=?", id);
    if (!p || p.category !== "Gear") fail("Choose a gear product.");
    const description = str(b.description || "", 5000),
      pickup = str(b.pickupNote || "", 500),
      label = str(b.personalizationLabel || "", 60),
      required = b.personalizationRequired === true ? 1 : 0,
      max = int(b.personalizationMax ?? 30, 1, 80);
    if (required && !label)
      fail("Give the personalization field a label, such as Last name.");
    if (!Array.isArray(b.images) || b.images.length > 8)
      fail("Use up to eight additional images.");
    const images = [...new Set(b.images.map(imagePath))];
    const old = await first(
      db,
      "SELECT * FROM product_details WHERE product_id=?",
      id,
    );
    await atomic(db, [
      guard(
        db,
        "EXISTS(SELECT 1 FROM products WHERE id=? AND version=?)",
        id,
        int(b.version),
      ),
      stmt(
        db,
        "INSERT INTO product_details(product_id,description,images,personalization_label,personalization_required,personalization_max,pickup_note) VALUES(?,?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET description=excluded.description,images=excluded.images,personalization_label=excluded.personalization_label,personalization_required=excluded.personalization_required,personalization_max=excluded.personalization_max,pickup_note=excluded.pickup_note,version=product_details.version+1",
        id,
        description,
        JSON.stringify(images),
        label,
        required,
        max,
        pickup,
      ),
      stmt(db, "UPDATE products SET version=version+1 WHERE id=?", id),
      audit(db, actor, "product_details_updated", id, {
        before: old,
        after: {
          description,
          images,
          personalizationLabel: label,
          personalizationRequired: required,
          personalizationMax: max,
          pickupNote: pickup,
        },
      }),
    ]);
    return { ok: true };
  }
  if (b.action === "variants") {
    const id = str(b.id, 80),
      p = await first(db, "SELECT * FROM products WHERE id=?", id);
    if (!p || p.category !== "Gear") fail("Choose a gear product.");
    if (
      !Array.isArray(b.variants) ||
      !b.variants.length ||
      b.variants.length > 80
    )
      fail("Enter between 1 and 80 product options.");
    const old = await rows(
        db,
        "SELECT * FROM product_variants WHERE product_id=?",
        id,
      ),
      seen = new Set<string>(),
      statements = [
        guard(
          db,
          "EXISTS(SELECT 1 FROM products WHERE id=? AND version=?)",
          id,
          int(b.version),
        ),
      ],
      after: Row[] = [];
    for (const item of b.variants) {
      const label = str(item.label, 100),
        size = str(item.size || "", 30),
        color = str(item.color || "", 50),
        active = item.active !== false ? 1 : 0,
        preorder = item.preorder === true ? 1 : 0;
      if (!label || seen.has(label.toLowerCase()))
        fail("Each option needs a unique name.");
      seen.add(label.toLowerCase());
      const v = item.id ? old.find((v) => v.id === item.id) : null;
      if (item.id && !v) fail("An option changed. Refresh and try again.", 409);
      const vid = v?.id || uid();
      after.push({
        id: vid,
        productId: id,
        label,
        size,
        color,
        active,
        preorder,
      });
      // New options start at zero. Existing stock, costs and prices are preserved.
    }
    if (old.some((v) => !after.some((a) => a.id === v.id)))
      fail(
        "Keep existing options in the list. Hide an option instead of deleting its history.",
      );
    statements.push(
      stmt(
        db,
        `INSERT INTO product_variants(id,product_id,label,size,color,active,preorder) SELECT json_extract(value,'$.id'),json_extract(value,'$.productId'),json_extract(value,'$.label'),json_extract(value,'$.size'),json_extract(value,'$.color'),json_extract(value,'$.active'),json_extract(value,'$.preorder') FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET label=excluded.label,size=excluded.size,color=excluded.color,active=excluded.active,preorder=excluded.preorder,version=product_variants.version+1`,
        JSON.stringify(after),
      ),
    );
    statements.push(
      stmt(db, "UPDATE products SET version=version+1 WHERE id=?", id),
      audit(db, actor, "product_options_updated", id, { before: old, after }),
    );
    await atomic(db, statements);
    return { ok: true };
  }
  if (b.action === "allocate") {
    const id = str(b.id, 80),
      variantId = str(b.variantId, 80),
      qty = int(b.qty, 1, 100000),
      p = await first(db, "SELECT * FROM products WHERE id=?", id),
      v = await first(
        db,
        "SELECT * FROM product_variants WHERE id=? AND product_id=?",
        variantId,
        id,
      );
    if (!p || !v || p.stock < qty)
      fail("Choose an option and a quantity within the unassigned stock.");
    const reason = str(b.reason || "", 200);
    if (!reason) fail("Record a note for this stock allocation.");
    const cost =
      v.stock === 0
        ? p.cost
        : v.cost === null || p.cost === null
          ? null
          : Math.round((v.stock * v.cost + qty * p.cost) / (v.stock + qty));
    await atomic(db, [
      guard(
        db,
        "EXISTS(SELECT 1 FROM products WHERE id=? AND stock=? AND version=?)",
        id,
        p.stock,
        int(b.version),
      ),
      guard(
        db,
        "EXISTS(SELECT 1 FROM product_variants WHERE id=? AND stock=? AND version=?)",
        v.id,
        v.stock,
        v.version,
      ),
      stmt(
        db,
        "UPDATE products SET stock=stock-?,version=version+1 WHERE id=?",
        qty,
        id,
      ),
      stmt(
        db,
        "UPDATE product_variants SET stock=stock+?,cost=?,version=version+1 WHERE id=?",
        qty,
        cost,
        v.id,
      ),
      audit(db, actor, "stock_allocated", id, {
        variantId,
        variant: v.label,
        qty,
        reason,
      }),
    ]);
    return { ok: true };
  }
  if (b.action === "variantStock") {
    const v = await first(
        db,
        "SELECT * FROM product_variants WHERE id=?",
        str(b.variantId, 80),
      ),
      qty = int(b.stock, 0, 100000),
      reason = str(b.reason || "", 200);
    if (!v || !reason)
      fail("Choose an option and record the stock adjustment reason.");
    await atomic(db, [
      guard(
        db,
        "EXISTS(SELECT 1 FROM product_variants WHERE id=? AND stock=? AND version=?)",
        v.id,
        int(b.previousStock),
        int(b.version),
      ),
      stmt(
        db,
        "UPDATE product_variants SET stock=?,version=version+1 WHERE id=?",
        qty,
        v.id,
      ),
      audit(db, actor, "option_stock_adjusted", v.product_id, {
        variantId: v.id,
        variant: v.label,
        before: v.stock,
        after: qty,
        reason,
      }),
    ]);
    return { ok: true };
  }
  if (b.action === "archive") {
    const id = str(b.id, 80),
      p = await first(db, "SELECT * FROM products WHERE id=?", id);
    if (!p) fail("Product not found.", 404);
    if (typeof b.archived !== "boolean") fail("Choose archive or restore.");
    await atomic(db, [
      guard(
        db,
        "EXISTS(SELECT 1 FROM products WHERE id=? AND version=?)",
        id,
        int(b.version),
      ),
      stmt(
        db,
        "INSERT INTO product_details(product_id,archived) VALUES(?,?) ON CONFLICT(product_id) DO UPDATE SET archived=excluded.archived,version=product_details.version+1",
        id,
        b.archived ? 1 : 0,
      ),
      stmt(db, "UPDATE products SET version=version+1 WHERE id=?", id),
      audit(
        db,
        actor,
        b.archived ? "product_archived" : "product_restored",
        id,
        {},
      ),
    ]);
    return { ok: true };
  }
  if (b.action === "price") {
    const id = str(b.id, 80),
      p = await first(db, "SELECT * FROM products WHERE id=?", id);
    if (!p) fail("Product not found.", 404);
    const variant = b.variantId
      ? await first(
          db,
          "SELECT * FROM product_variants WHERE id=? AND product_id=?",
          str(b.variantId, 80),
          id,
        )
      : null;
    if (b.variantId && !variant) fail("Option not found.");
    let price = b.price === null && variant ? null : int(b.price, 1, 100000);
    if (p.category !== "Gear" && price !== null)
      price = Math.ceil(price / 25) * 25;
    const tax = b.taxBp === undefined ? p.tax_bp : int(b.taxBp, 0, 3000),
      cost =
        b.cost === undefined
          ? variant
            ? variant.cost
            : p.cost
          : b.cost === null
            ? null
            : int(b.cost, 0, 1000000),
      old = variant || p;
    const statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM products WHERE id=? AND version=?)",
        id,
        int(b.version),
      ),
    ];
    if (variant) {
      statements.push(
        guard(
          db,
          "EXISTS(SELECT 1 FROM product_variants WHERE id=? AND version=?)",
          variant.id,
          int(b.variantVersion),
        ),
        stmt(
          db,
          "UPDATE product_variants SET price=?,cost=?,version=version+1 WHERE id=?",
          price,
          cost,
          variant.id,
        ),
      );
      if (b.taxBp !== undefined && tax !== p.tax_bp)
        fail("Change product tax treatment on the base price.");
      statements.push(
        stmt(db, "UPDATE products SET version=version+1 WHERE id=?", id),
      );
    } else
      statements.push(
        stmt(
          db,
          "UPDATE products SET price=?,cost=?,tax_bp=?,version=version+1 WHERE id=?",
          price,
          cost,
          tax,
          id,
        ),
      );
    statements.push(
      audit(db, actor, "price_updated", id, {
        variantId: variant?.id || null,
        variant: variant?.label || null,
        before: { price: old.price, cost: old.cost, taxBp: p.tax_bp },
        after: { price, cost, taxBp: tax },
      }),
    );
    await atomic(db, statements);
    return { ok: true, price };
  }
  if (b.action === "receive") {
    const id = str(b.id, 80),
      qty = int(b.qty, 1, 100000),
      amount = int(b.amount, 1, 10000000),
      reference = str(b.reference, 200);
    if (!reference) fail("Enter a receipt or supplier reference.");
    const p = await first(db, "SELECT * FROM products WHERE id=?", id);
    if (!p) fail("Choose a stocked product.");
    const v = b.variantId
      ? await first(
          db,
          "SELECT * FROM product_variants WHERE id=? AND product_id=?",
          str(b.variantId, 80),
          id,
        )
      : null;
    if (b.variantId && !v) fail("Option not found.");
    const item = v || p;
    if (item.preorder)
      fail(
        "Receive stocked items here. Use pickup tracking for incoming preorders.",
      );
    const oldCost = v ? (v.cost ?? p.cost) : p.cost,
      cost =
        item.stock === 0
          ? Math.round(amount / qty)
          : oldCost === null
            ? null
            : Math.round((item.stock * oldCost + amount) / (item.stock + qty));
    const statements = [
      guard(
        db,
        `EXISTS(SELECT 1 FROM ${v ? "product_variants" : "products"} WHERE id=? AND stock=? AND version=?)`,
        item.id,
        item.stock,
        item.version,
      ),
      stmt(
        db,
        `UPDATE ${v ? "product_variants" : "products"} SET stock=stock+?,cost=?,version=version+1 WHERE id=?`,
        qty,
        cost,
        item.id,
      ),
      stmt(
        db,
        "INSERT INTO expenses(id,kind,amount,description,created_at) VALUES(?,?,?,?,?)",
        uid(),
        "stock",
        amount,
        reference,
        Date.now(),
      ),
      stmt(
        db,
        "INSERT INTO restock_entries(id,product_id,variant_id,qty,total_cost,reference,created_at,actor) VALUES(?,?,?,?,?,?,?,?)",
        uid(),
        id,
        v?.id || null,
        qty,
        amount,
        reference,
        Date.now(),
        actor,
      ),
      audit(db, actor, "stock_received", id, {
        variantId: v?.id || null,
        variant: v?.label || null,
        qty,
        amount,
        reference,
        previousStock: item.stock,
        newCost: cost,
      }),
    ];
    await atomic(db, statements);
    return { ok: true };
  }
  if (b.action === "fulfillment") {
    const id = str(b.itemId, 80),
      status = str(b.status, 30);
    if (!["awaiting_stock", "ready", "fulfilled"].includes(status))
      fail("Choose a pickup status.");
    const item = await first(
      db,
      "SELECT i.*,o.status order_status,d.fulfillment FROM order_items i JOIN orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id LEFT JOIN order_item_details d ON d.item_id=i.id WHERE i.id=? AND p.category='Gear'",
      id,
    );
    if (
      !item ||
      item.order_status === "void" ||
      !(await first(
        db,
        "SELECT id FROM item_balances WHERE id=? AND remaining_qty>0",
        id,
      ))
    )
      fail("Choose a current gear order.");
    if (status === "fulfilled" && item.order_status !== "paid")
      fail("Confirm payment before marking this pickup complete.");
    if ((item.fulfillment || null) !== (b.previousStatus || null))
      fail("Pickup status changed. Refresh and try again.", 409);
    await atomic(db, [
      guard(
        db,
        "EXISTS(SELECT 1 FROM orders WHERE id=? AND status<>'void' AND (?<>'fulfilled' OR status='paid'))",
        item.order_id,
        status,
      ),
      guard(
        db,
        "EXISTS(SELECT 1 FROM item_balances WHERE id=? AND remaining_qty>0)",
        id,
      ),
      guard(
        db,
        "COALESCE((SELECT fulfillment FROM order_item_details WHERE item_id=?),'')=?",
        id,
        item.fulfillment || "",
      ),
      stmt(
        db,
        "INSERT INTO order_item_details(item_id,fulfillment,updated_at) VALUES(?,?,?) ON CONFLICT(item_id) DO UPDATE SET fulfillment=excluded.fulfillment,updated_at=excluded.updated_at",
        id,
        status,
        Date.now(),
      ),
      audit(db, actor, "pickup_status_updated", id, {
        before: item.fulfillment || "untracked",
        after: status,
      }),
    ]);
    return { ok: true };
  }
  return undefined;
}
