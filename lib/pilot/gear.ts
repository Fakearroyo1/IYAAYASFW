import {
  type DB,
  type Row,
  fail,
  str,
  int,
  uid,
  reqId,
  first,
  rows,
  stmt,
  guard,
  audit,
} from "./core";

function image(value: unknown) {
  const path = str(value, 500);
  if (
    !/^\/(?:products\/|api\/product-images\?id=)[a-zA-Z0-9_./?=\-]+$/.test(path)
  )
    fail("Upload a valid product image.");
  return path;
}

// One transaction publishes the complete product. Ordinary editing never writes
// existing stock; receiving and count corrections retain their own audit.
export async function saveGear(
  db: DB,
  actor: string,
  b: Row,
  atomic: (db: DB, s: D1PreparedStatement[]) => Promise<unknown>,
) {
  const creating = b.create === true,
    id = creating ? reqId(b.id) : str(b.id, 80);
  const before = await first(db, "SELECT * FROM products WHERE id=?", id);
  if (creating ? !!before : !before || before.category !== "Gear")
    fail("This gear item changed. Reload before saving.", 409);
  const details = await first(
    db,
    "SELECT * FROM product_details WHERE product_id=?",
    id,
  );
  if (details?.archived) fail("Restore this archived item before editing it.");
  const old = await rows(
    db,
    "SELECT * FROM product_variants WHERE product_id=? ORDER BY rowid",
    id,
  );
  const name = str(b.name, 100),
    detail = str(b.detail || "", 200),
    description = str(b.description || "", 5000);
  const price = b.price === null ? null : int(b.price, 1, 100000),
    tax = b.taxBp === null ? null : int(b.taxBp, 0, 3000);
  const cost =
    b.cost === undefined
      ? (before?.cost ?? null)
      : b.cost === null
        ? null
        : int(b.cost, 0, 1000000);
  if (!name) fail("Enter a product name.");
  if (typeof b.active !== "boolean" || typeof b.preorder !== "boolean")
    fail("Choose a visibility and ordering mode.");
  const active = b.active ? 1 : 0,
    preorder = b.preorder ? 1 : 0;
  const mainImage = b.image ? image(b.image) : null;
  if (!Array.isArray(b.images) || b.images.length > 8)
    fail("Use up to eight additional images.");
  const images = [...new Set(b.images.map(image))].filter(
    (x) => x !== mainImage,
  );
  const label = str(b.personalizationLabel || "", 60),
    required = b.personalizationRequired === true ? 1 : 0;
  const max = int(b.personalizationMax ?? 30, 1, 80),
    pickup = str(b.pickupNote || "", 500);
  if (required && !label)
    fail("Give the required personalization field a label.");
  if (!Array.isArray(b.variants) || b.variants.length > 80)
    fail("Use up to 80 options.");
  const seen = new Set<string>(),
    ids = new Set<string>();
  const variants = b.variants.map((item: Row) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      fail("Enter a valid product option.");
    const previous = item.id ? old.find((v) => v.id === item.id) : null;
    if (item.id && !previous)
      fail("An option changed. Reload before saving.", 409);
    const option = str(item.label, 100),
      optionId = previous?.id || uid();
    if (!option || seen.has(option.toLowerCase()) || ids.has(optionId))
      fail("Each option needs a unique name.");
    seen.add(option.toLowerCase());
    ids.add(optionId);
    const v: Row = {
      id: optionId,
      productId: id,
      label: option,
      size: str(item.size || "", 30),
      color: str(item.color || "", 50),
      price: item.price === null ? null : int(item.price, 1, 100000),
      cost:
        item.cost === undefined
          ? (previous?.cost ?? null)
          : item.cost === null
            ? null
            : int(item.cost, 0, 1000000),
      active: item.active === true ? 1 : 0,
      preorder: item.preorder === true ? 1 : 0,
      stock: previous ? previous.stock : int(item.stock ?? 0, 0, 100000),
      version: previous ? int(item.version) : 0,
    };
    if (previous && item.stock !== undefined && item.stock !== previous.stock)
      fail("Use Adjust count to change existing inventory.");
    return v;
  });
  if (old.some((v) => !ids.has(v.id)))
    fail("Hide existing options instead of deleting their history.");
  if (
    active &&
    (tax === null ||
      (variants.length
        ? !variants.some((v: Row) => v.active) ||
          variants.some((v: Row) => v.active && !(v.price ?? price))
        : !price))
  )
    fail(
      "To publish, set the tax rate and a price for every available option.",
    );
  const stock = creating ? int(b.stock ?? 0, 0, 100000) : before!.stock;
  if (!creating && b.stock !== undefined && b.stock !== stock)
    fail("Use Adjust count to change existing inventory.");
  const openingStock =
    (creating ? stock : 0) +
    variants
      .filter((v: Row) => !old.some((x) => x.id === v.id))
      .reduce((n: number, v: Row) => n + v.stock, 0);
  const stockReason = str(b.stockReason || "", 200);
  if (openingStock && !stockReason)
    fail("Record a reason for the opening inventory counts.");
  const after = {
    name,
    detail,
    image: mainImage,
    price,
    taxBp: tax,
    cost,
    active,
    preorder,
    description,
    images,
    personalizationLabel: label,
    personalizationRequired: required,
    personalizationMax: max,
    pickupNote: pickup,
    variants,
  };
  const statements = [
    creating
      ? guard(db, "NOT EXISTS(SELECT 1 FROM products WHERE id=?)", id)
      : guard(
          db,
          "EXISTS(SELECT 1 FROM products WHERE id=? AND version=?)",
          id,
          int(b.version),
        ),
  ];
  // A bulk guard avoids exceeding D1 query limits for the 80-option editor.
  statements.push(
    guard(
      db,
      `NOT EXISTS(SELECT 1 FROM product_variants v LEFT JOIN json_each(?) j ON json_extract(j.value,'$.id')=v.id WHERE v.product_id=? AND (j.value IS NULL OR v.version<>json_extract(j.value,'$.version')))`,
      JSON.stringify(variants),
      id,
    ),
  );
  if (creating)
    statements.push(
      stmt(
        db,
        "INSERT INTO products(id,name,category,detail,image,price,tax_bp,cost,stock,active,preorder) VALUES(?,?,'Gear',?,?,?,?,?,?,?,?)",
        id,
        name,
        detail,
        mainImage,
        price,
        tax,
        cost,
        stock,
        active,
        preorder,
      ),
    );
  else
    statements.push(
      stmt(
        db,
        "UPDATE products SET name=?,detail=?,image=?,price=?,tax_bp=?,cost=?,active=?,preorder=?,version=version+1 WHERE id=?",
        name,
        detail,
        mainImage,
        price,
        tax,
        cost,
        active,
        preorder,
        id,
      ),
    );
  statements.push(
    stmt(
      db,
      `INSERT INTO product_details(product_id,description,images,personalization_label,personalization_required,personalization_max,pickup_note) VALUES(?,?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET description=excluded.description,images=excluded.images,personalization_label=excluded.personalization_label,personalization_required=excluded.personalization_required,personalization_max=excluded.personalization_max,pickup_note=excluded.pickup_note,version=product_details.version+1`,
      id,
      description,
      JSON.stringify(images),
      label,
      required,
      max,
      pickup,
    ),
  );
  // Rename in two phases so swapping two existing labels does not hit the unique
  // product/label index midway through an otherwise valid save.
  statements.push(
    stmt(
      db,
      "UPDATE product_variants SET label=? || id WHERE product_id=?",
      uid() + ":",
      id,
    ),
  );
  statements.push(
    stmt(
      db,
      `INSERT INTO product_variants(id,product_id,label,size,color,price,cost,stock,active,preorder)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.productId'),json_extract(value,'$.label'),json_extract(value,'$.size'),json_extract(value,'$.color'),json_extract(value,'$.price'),json_extract(value,'$.cost'),json_extract(value,'$.stock'),json_extract(value,'$.active'),json_extract(value,'$.preorder') FROM json_each(?) WHERE 1
    ON CONFLICT(id) DO UPDATE SET label=excluded.label,size=excluded.size,color=excluded.color,price=excluded.price,cost=excluded.cost,active=excluded.active,preorder=excluded.preorder,version=product_variants.version+1`,
      JSON.stringify(variants),
    ),
  );
  statements.push(
    audit(db, actor, "gear_saved", id, {
      before: { product: before, details, variants: old },
      after,
      openingStock,
      stockReason,
    }),
  );
  if (
    creating ||
    before!.price !== price ||
    before!.tax_bp !== tax ||
    before!.cost !== cost ||
    variants.some((v: Row) => old.find((x) => x.id === v.id)?.price !== v.price)
  )
    statements.push(
      audit(db, actor, "price_updated", id, {
        before: {
          price: before?.price ?? null,
          taxBp: before?.tax_bp ?? null,
          cost: before?.cost ?? null,
          variants: old.map((v) => ({
            id: v.id,
            price: v.price,
            cost: v.cost,
          })),
        },
        after: {
          price,
          taxBp: tax,
          cost,
          variants: variants.map((v: Row) => ({
            id: v.id,
            price: v.price,
            cost: v.cost,
          })),
        },
      }),
    );
  await atomic(db, statements);
  return { ok: true, productId: id };
}
