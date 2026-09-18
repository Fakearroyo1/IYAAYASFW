import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const out = path.resolve(".sites-runtime/round-tests");
fs.mkdirSync(out, { recursive: true });
for (const name of fs
  .readdirSync("lib/pilot")
  .filter((n) => n.endsWith(".ts"))) {
  const code = ts
    .transpileModule(fs.readFileSync("lib/pilot/" + name, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(/from (['"])(\.\/[^'"]+)\1/g, 'from "$2.mjs"');
  fs.writeFileSync(out + "/" + name.replace(".ts", ".mjs"), code);
}
fs.writeFileSync(
  out + "/owner.mjs",
  "export const OWNER_EMAIL='owner@example.test';",
);
const { mutate, readState, identity } = await import(out + "/service.mjs");
const { mutateCommunity, communityPage } = await import(out + "/community.mjs");
const { transactionDetail, correctionAmounts } = await import(
  out + "/transactions.mjs"
);
const { adminSummary, productPerformance, historyPage } = await import(
  out + "/history.mjs"
);
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const f of fs
  .readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  sqlite.exec(fs.readFileSync("drizzle/" + f, "utf8"));
for (const f of [
  "AUTH-SCHEMA.sql",
  "PRODUCT-SCHEMA.sql",
  "SECURITY-SCHEMA.sql",
  "BETA-SCHEMA.sql",
  "ROUNDS-SCHEMA.sql",
])
  sqlite.exec(fs.readFileSync(f, "utf8"));
class Statement {
  constructor(sql, v = []) {
    this.sql = sql;
    this.v = v;
  }
  bind(...v) {
    return new Statement(this.sql, v);
  }
  async first() {
    return sqlite.prepare(this.sql).get(...this.v) || null;
  }
  async all() {
    return { results: sqlite.prepare(this.sql).all(...this.v) };
  }
  async run() {
    return sqlite.prepare(this.sql).run(...this.v);
  }
}
const db = {
  prepare: (sql) => new Statement(sql),
  batch: async (ss) => {
    sqlite.exec("BEGIN");
    try {
      const r = ss.map((s) => sqlite.prepare(s.sql).run(...s.v));
      sqlite.exec("COMMIT");
      return r;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  },
};
const owner = { userId: "owner-user", email: "owner@example.test" },
  buyer = { userId: "buyer-user", email: "buyer@example.test" },
  gearOnly = { userId: "gear-only-user", email: "gear@example.test" };
const send = (u, b) => mutate(db, u, { requestId: crypto.randomUUID(), ...b });
let checks = 0;
const check = (v, m) => {
  assert.ok(v, m);
  checks++;
};
const reject = async (fn, pattern) => {
  await assert.rejects(fn, pattern);
  checks++;
};
await readState(db, owner);
for (const u of [buyer, gearOnly]) {
  await send(owner, {
    action: "member",
    email: u.email,
    name: u === buyer ? "Buyer" : "Gear member",
    debt: 0,
    credit: 0,
    tabLimit: 3000,
    snacks: u === buyer,
    gear: true,
  });
  await identity(db, u);
}
const originalProducts = await db
  .prepare("SELECT * FROM products ORDER BY id")
  .all();
const id = crypto.randomUUID();
const creation = {
  action: "saveGear",
  id,
  create: true,
  name: "Unit shirt",
  detail: "Soft cotton",
  description: "Size guide",
  image: "/products/coca-cola.png",
  images: ["/products/monster-white.jpg"],
  price: null,
  cost: 1200,
  taxBp: null,
  active: false,
  preorder: false,
  personalizationLabel: "",
  personalizationRequired: false,
  personalizationMax: 30,
  pickupNote: "Unit pickup",
  stock: 4,
  stockReason: "Opening count",
  variants: [],
};
await reject(() => send(buyer, creation), /Administrator/);
await send(owner, creation);
const catalog = async () =>
  (await readState(db, owner, { view: "catalog", includeAdmin: true }))
    .products;
const get = async () => (await catalog()).find((p) => p.id === id);
check(
  !(await readState(db, buyer, { view: "catalog" })).products.some(
    (p) => p.id === id,
  ),
  "Draft hidden from members",
);
check(
  JSON.stringify(
    await db
      .prepare("SELECT * FROM products WHERE id<>? ORDER BY id")
      .bind(id)
      .all(),
  ) === JSON.stringify(originalProducts),
  "Creation preserves all existing product records",
);
const payload = async (extra = {}) => {
  const p = await get();
  return {
    ...creation,
    create: false,
    version: p.version,
    stock: undefined,
    price: p.price,
    cost: p.cost,
    taxBp: p.tax_bp,
    active: !!p.active,
    variants: p.variants.map(({ stock, ...v }) => ({
      ...v,
      active: !!v.active,
      preorder: !!v.preorder,
    })),
    ...extra,
  };
};
await reject(
  async () => send(owner, await payload({ active: true })),
  /To publish/,
);
check((await get()).active === 0, "Failed publish preserves draft");
const publish = await payload({
  active: true,
  price: 2500,
  taxBp: 0,
  variants: [
    {
      label: "Medium / Black",
      size: "M",
      color: "Black",
      price: null,
      stock: 2,
      active: true,
      preorder: false,
    },
    {
      label: "2XL / Black",
      size: "2XL",
      color: "Black",
      price: 3000,
      stock: 3,
      active: true,
      preorder: false,
    },
    {
      label: "Large / Navy",
      size: "L",
      color: "Navy",
      price: null,
      stock: 0,
      active: true,
      preorder: true,
    },
  ],
});
const request = { ...publish, requestId: crypto.randomUUID() };
await send(owner, request);
await send(owner, request);
let p = await get();
check(
  p.active && p.variants.length === 3 && p.stock === 4,
  "One publish creates complete item without reallocating unassigned stock",
);
check(
  (
    await db
      .prepare(
        "SELECT COUNT(*) n FROM audit WHERE kind='gear_saved' AND target=?",
      )
      .bind(id)
      .first()
  ).n === 2,
  "Retry writes no duplicate product audit",
);
let memberProduct = (
  await readState(db, buyer, { view: "catalog" })
).products.find((p) => p.id === id);
check(
  memberProduct.description === "Size guide" &&
    memberProduct.images.length === 1 &&
    !("cost" in memberProduct) &&
    !("cost" in memberProduct.variants[0]),
  "Member product details are complete without private costs",
);
await send(owner, {
  action: "settings",
  enabled: true,
  cashtag: "ExampleSupply",
  cashInstructions: "Cash box",
  reminderDays: 7,
});
const [medium, large, preorder] = p.variants;
const buy = (variant, price, qty = 1, extra = {}) => ({
  action: "order",
  id: crypto.randomUUID(),
  method: "cash",
  items: [{ id, variantId: variant, price, qty }],
  ...extra,
});
await reject(() => send(buyer, buy("", 2500)), /size|option/i);
await reject(() => send(buyer, buy(large.id, 2500)), /price/i);
await reject(() => send(buyer, buy(medium.id, 2500, 3)), /stock/i);
const duringPurchase = await payload({ name: "Sale-safe edit", price: 2500 });
const order = await send(buyer, buy(large.id, 3000));
check(
  order.order.total === 3000 && order.order.status === "pending",
  "Selected option price is authoritative and external payment awaits confirmation",
);
check(
  (await get()).variants.find((v) => v.id === large.id).stock === 2 &&
    (await get()).stock === 4,
  "Purchase deducts selected option only",
);
await send(owner, duringPurchase);
check(
  (await get()).variants.find((v) => v.id === large.id).stock === 2,
  "Saving an open metadata form preserves purchases made since it opened",
);
const stale = await payload({ name: "Stale edit" });
await send(
  owner,
  await payload({ description: "Concurrent administrator change" }),
);
const beforeStale = JSON.stringify(await get());
await reject(() => send(owner, stale), /changed|recorded/);
check(
  JSON.stringify(await get()) === beforeStale,
  "Stale editor atomically preserves product and every option",
);
await send(buyer, buy(preorder.id, 2500, 2));
check(
  (await get()).variants.find((v) => v.id === preorder.id).stock === 0,
  "Preorder remains separate from on-hand stock",
);
const edit = await payload({
  name: "Updated shirt",
  description: "Updated fit guide",
  price: 2700,
});
edit.variants[1].price = 3200;
edit.cost = 1300;
edit.variants[1].cost = 1600;
await send(owner, edit);
check(
  (await get()).variants[1].stock === 2,
  "Ordinary editing preserves sold stock",
);
check(
  (
    await db
      .prepare("SELECT price FROM order_items WHERE order_id=?")
      .bind(order.order.id)
      .first()
  ).price === 3000,
  "Price updates preserve original purchase price",
);
check(
  (await get()).cost === 1300 && (await get()).variants[1].cost === 1600,
  "Gear cost changes are recorded in the same workspace",
);
check(
  (
    await db
      .prepare("SELECT cost FROM order_items WHERE order_id=?")
      .bind(order.order.id)
      .first()
  ).cost === 1200,
  "Recorded cost edits preserve historical sale cost",
);
await reject(
  () => send(owner, { ...creation, id: crypto.randomUUID(), variants: [null] }),
  /valid product option/,
);
let rename = await payload();
[rename.variants[0].label, rename.variants[1].label] = [
  rename.variants[1].label,
  rename.variants[0].label,
];
await send(owner, rename);
check(
  (await get()).variants[0].id === medium.id,
  "Swapping labels preserves option identities and order history",
);
let removed = await payload();
removed.variants.pop();
await reject(() => send(owner, removed), /Hide existing/);
let forged = await payload();
forged.variants[0].id = crypto.randomUUID();
await reject(() => send(owner, forged), /option changed/);
let duplicate = await payload();
duplicate.variants[1].label = duplicate.variants[0].label.toUpperCase();
await reject(() => send(owner, duplicate), /unique/);
let stockEdit = await payload();
stockEdit.variants[0].stock = 999;
await reject(() => send(owner, stockEdit), /Adjust count/);
let disabled = await payload();
disabled.variants[0].active = false;
await send(owner, disabled);
await reject(() => send(buyer, buy(medium.id, 2700)), /available|option/i);
check(
  !(await readState(db, buyer, { view: "catalog" })).products
    .find((p) => p.id === id)
    .variants.some((v) => v.id === medium.id),
  "Hidden options stay out of member catalog",
);
const latest = await get();
await send(owner, {
  action: "allocate",
  id,
  version: latest.version,
  variantId: large.id,
  qty: 2,
  reason: "Counted sizes",
});
check(
  (await get()).stock === 2 &&
    (await get()).variants.find((v) => v.id === large.id).stock === 4,
  "Allocation moves stock without increasing total",
);
await send(owner, {
  action: "receive",
  id,
  variantId: large.id,
  qty: 3,
  amount: 3000,
  reference: "Fixture invoice",
});
check(
  (await get()).variants.find((v) => v.id === large.id).stock === 7,
  "Explicit receiving records stock within Gear Manager workflow",
);
await send(owner, {
  action: "variantStock",
  variantId: large.id,
  version: (await get()).variants.find((v) => v.id === large.id).version,
  previousStock: 7,
  stock: 6,
  reason: "Counted damaged unit",
});
check(
  (await get()).variants.find((v) => v.id === large.id).stock === 6,
  "Explicit count correction changes only selected option",
);
const simpleId = crypto.randomUUID();
await send(owner, {
  ...creation,
  id: simpleId,
  name: "Patch",
  stock: 2,
  price: 500,
  taxBp: 0,
  active: true,
});
await send(owner, {
  action: "gearStock",
  id: simpleId,
  version: 0,
  previousStock: 2,
  stock: 1,
  reason: "Physical count",
});
check(
  (
    await db
      .prepare("SELECT stock FROM products WHERE id=?")
      .bind(simpleId)
      .first()
  ).stock === 1,
  "Simple gear count correction works",
);
await reject(
  () =>
    send(owner, {
      action: "gearStock",
      id,
      version: latest.version,
      previousStock: 2,
      stock: 100,
      reason: "Wrong workflow",
    }),
  /changed|recorded/,
);
const many = Array.from({ length: 80 }, (_, i) => ({
  label: "Size " + i,
  size: String(i),
  color: "Black",
  price: i % 2 ? null : 1000,
  stock: 0,
  active: true,
  preorder: true,
}));
const manyId = crypto.randomUUID();
await send(owner, {
  ...creation,
  id: manyId,
  name: "Many options",
  stock: 0,
  price: 1000,
  taxBp: 0,
  active: true,
  variants: many,
});
check(
  (await catalog()).find((p) => p.id === manyId).variants.length === 80,
  "Bulk editor handles all 80 options",
);
const snack = await db
  .prepare("SELECT * FROM products WHERE id='monster'")
  .first();
await send(owner, {
  ...snack,
  action: "product",
  price: 250,
  cost: 100,
  taxBp: 0,
  stock: 50,
  previousStock: snack.stock,
  reorder: 5,
  active: true,
  preorder: false,
  reason: "Fixture stock",
});
const snackOrder = await send(buyer, {
  action: "order",
  id: crypto.randomUUID(),
  method: "tab",
  items: [{ id: "monster", qty: 1, price: 250 }],
});
let state = await readState(db, buyer, { view: "catalog" });
check(
  state.buyAgain.length === 1 && state.buyAgain[0] === "monster",
  "Buy Again uses member snack purchases only",
);
check(
  (await readState(db, gearOnly, { view: "catalog" })).buyAgain.length === 0,
  "Gear-only account receives no snack recommendations",
);
check(
  (await readState(db, owner, { view: "catalog" })).buyAgain.length === 0,
  "Another member does not receive buyer history",
);
await sqlite.exec("UPDATE products SET price=275 WHERE id='monster'");
state = await readState(db, buyer, { view: "catalog" });
check(
  state.products.find((p) => p.id === "monster").price === 275,
  "Repeat purchase uses current catalog price",
);
await db
  .prepare("UPDATE orders SET status='void' WHERE id=?")
  .bind(snackOrder.order.id)
  .run();
check(
  (await readState(db, buyer, { view: "catalog" })).buyAgain.length === 0,
  "Voided purchases are excluded from Buy Again",
);
const {
  selectionState,
  productPrice,
  cartLines,
  cartValid,
  gearKey,
  canAddLine,
} = await import(out + "/cart.mjs");
const sample = {
  id: "shirt",
  category: "Gear",
  active: 1,
  price: 2500,
  tax_bp: 0,
  stock: 99,
  option_required: true,
  variants: [
    { id: "m", label: "M", active: 1, price: null, stock: 2, preorder: 0 },
    { id: "xl", label: "XL", active: 1, price: 3000, stock: 0, preorder: 1 },
  ],
};
check(
  selectionState(sample).needsOption && selectionState(sample).stock === 0,
  "No false parent stock before selecting an option",
);
check(
  selectionState(sample, "xl").preorder &&
    selectionState(sample, "xl").price === 3000,
  "Selection reads option price and preorder mode",
);
check(
  productPrice(sample).price === 2500 && productPrice(sample).varies,
  "Cards show accurate price range",
);
check(
  !cartValid(cartLines({ shirt: 1 }, [sample])),
  "Client rejects an optionless gear line",
);
const one = gearKey("shirt", "m", "Alpha", 2500),
  two = gearKey("shirt", "m", "Beta", 2500);
check(
  !cartValid(cartLines({ [one]: 2, [two]: 1 }, [sample])),
  "Personalized lines share the option stock limit",
);
const valid = cartLines({ [one]: 2 }, [sample]);
check(
  cartValid(valid) && !canAddLine(valid[0], valid),
  "Exact remaining stock is valid and cannot be incremented",
);
check(
  !cartValid(cartLines({ [one]: 1 }, [{ ...sample, price: 2700 }])),
  "Price changes need explicit acceptance",
);
const absent = cartLines({ [one]: 1 }, []);
check(
  absent.length === 1 && absent[0].unavailable && !cartValid(absent),
  "Unavailable items remain removable instead of disappearing silently",
);
console.log("Gear workspace and fast checkout checks: " + checks);
