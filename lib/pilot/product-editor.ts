import {
  type DB,
  type Row,
  first,
  stmt,
  guard,
  fail,
  int,
  str,
  reqId,
  audit,
} from "./core";
import { optionStatements } from "./purchasing";
export async function saveProduct(
  db: DB,
  actor: string,
  b: Row,
  atomic: (db: DB, s: D1PreparedStatement[]) => Promise<unknown>,
) {
  const id = b.create === true ? reqId(b.id) : str(b.id, 80),
    old = await first(db, "SELECT * FROM products WHERE id=?", id);
  if (b.create === true ? !!old : !old)
    fail("This product changed. Review it before saving.", 409);
  if (old?.category === "Gear" || b.category === "Gear")
    fail(
      "Use the Gear product editor to preserve options and personalization.",
    );
  const name = str(b.name, 100),
    category = str(b.category, 20),
    price = b.price === null ? null : int(b.price, 1, 100000),
    tax = b.taxBp === null ? null : int(b.taxBp, 0, 3000),
    active = b.active === true ? 1 : 0;
  if (!name || !["Drinks", "Snacks", "Frozen"].includes(category))
    fail("Enter a product name and category.");
  if (active && (price === null || tax === null))
    fail(
      "Enter a selling price and choose a tax setting to make this item available.",
    );
  const rounded = price === null ? null : Math.ceil(price / 25) * 25,
    stock = old ? old.stock : int(b.openingStock || 0, 0, 100000),
    cost = old ? old.cost : b.cost == null ? null : int(b.cost, 0, 1000000),
    image = b.image ? str(b.image, 500) : null;
  if (
    image &&
    !/^\/(?:products\/|api\/product-images\?id=)[a-zA-Z0-9_./?=\-]+$/.test(
      image,
    )
  )
    fail("Choose an uploaded product image.");
  const statements = [
    guard(
      db,
      "COALESCE((SELECT version FROM products WHERE id=?),-1)=?",
      id,
      old ? int(b.version) : -1,
    ),
    stmt(
      db,
      `INSERT INTO products(id,name,category,detail,image,price,cost,tax_bp,stock,reorder,active,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,detail=excluded.detail,image=excluded.image,price=excluded.price,tax_bp=excluded.tax_bp,reorder=excluded.reorder,active=excluded.active,version=products.version+1`,
      id,
      name,
      category,
      str(b.detail || "", 160),
      image,
      rounded,
      cost,
      tax,
      stock,
      int(b.reorder ?? 5, 0, 10000),
      active,
      old?.position || 99,
    ),
  ];
  if (b.purchase) {
    const option = await optionStatements(db, id, "", b.purchase, actor);
    statements.push(...option.statements);
  }
  statements.push(
    audit(db, actor, "product_saved", id, {
      before: old
        ? {
            name: old.name,
            price: old.price,
            tax: old.tax_bp,
            active: old.active,
          }
        : null,
      after: { name, price: rounded, tax, active },
      openingUnits: old ? null : stock,
      stockUnchanged: !!old,
    }),
  );
  await atomic(db, statements);
  return { ok: true, productId: id };
}
