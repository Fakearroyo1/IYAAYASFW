import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture } from "./identity-fixture.mjs";
const f = await fixture({ workflow: false }),
  { db, sqlite, hooks } = f;
sqlite.exec(
  "INSERT INTO settings(id,enabled,cashtag) VALUES('main',1,'synthetic'); INSERT INTO members(id,email,name,role,debt,credit) VALUES('owner','owner@example.test','Owner','admin',0,0),('member','member@example.test','Existing member','member',775,225); INSERT INTO products(id,name,category,stock,price,tax_bp,active,cost) VALUES('a','Drink','Drinks',0,250,0,1,NULL),('b','Snack','Snacks',0,100,0,1,NULL),('c','Unknown price','Snacks',3,100,0,1,NULL); INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES('cash-old','owner','cashcount','fund','{\"amount\":7000,\"description\":\"Historical counters\"}',1); INSERT INTO restock_runs(id,name,status,actor,created_at) VALUES('legacy','Old run','received','owner',1); INSERT INTO restock_entries(id,product_id,qty,total_cost,reference,created_at,actor) VALUES('legacy-receipt','a',2,500,'Historical receipt',1,'owner');",
);
const oldTables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((x) => x.name),
  snapshot = () =>
    Object.fromEntries(
      oldTables.map((n) => [
        n,
        sqlite.prepare('SELECT * FROM "' + n + '" ORDER BY rowid').all(),
      ]),
    ),
  before = snapshot();
sqlite.exec(readFileSync("WORKFLOW-SCHEMA.sql", "utf8"));
sqlite.exec(readFileSync("WORKFLOW-SCHEMA.sql", "utf8"));
assert.deepEqual(
  snapshot(),
  before,
  "two additive migrations preserve every original row",
);
const M = await f.module("lib/pilot/money"),
  P = await f.module("lib/pilot/purchasing"),
  S = await f.module("lib/pilot/service"),
  H = await f.module("lib/pilot/history"),
  Maths = await f.module("lib/pilot/purchase-math");
const admin = { id: "owner", email: "owner@example.test", role: "admin" },
  user = { memberId: "owner", userId: "owner", email: "owner@example.test" },
  member = { id: "member", role: "member" },
  id = () => crypto.randomUUID();
let checks = 1;
const equal = (a, b, message) => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(a)),
      JSON.parse(JSON.stringify(b)),
      message,
    );
    checks++;
  },
  check = (a, message) => {
    assert.ok(a, message);
    checks++;
  },
  reject = async (fn) => {
    await assert.rejects(fn);
    checks++;
  };
const purchase = (b) =>
    P.mutatePurchasing(db, admin, { requestId: id(), ...b }),
  money = (b) => M.mutateMoney(db, admin, { requestId: id(), ...b });
equal(
  sqlite.prepare("SELECT count(*) n FROM money_observations").get().n,
  1,
  "legacy count surfaced once",
);
equal(
  (await M.moneySummary(db)).funds,
  null,
  "old cash count is not a complete balance",
);
await reject(() =>
  M.mutateMoney(db, member, {
    action: "moneyCheck",
    requestId: id(),
    accounts: [],
  }),
);
const t = Date.now() - 1000;
await money({
  action: "moneyCheck",
  reviewer: "Second counter",
  accounts: [
    {
      account: "cash",
      amount: 20000,
      observedAt: t,
      previousId: "legacy-cash:cash-old",
      ledgerComplete: true,
    },
    { account: "cashapp", amount: 30000, observedAt: t, ledgerComplete: true },
  ],
});
equal(
  (await M.moneySummary(db)).funds,
  50000,
  "both checked accounts included",
);
await purchase({
  action: "purchaseOption",
  productId: "a",
  supplier: "Store",
  unitsPerPack: 24,
  packPrice: 4493,
  priceKind: "default",
});
await purchase({
  action: "purchaseOption",
  productId: "b",
  supplier: "Store",
  unitsPerPack: 35,
  packPrice: 1950,
  priceKind: "default",
});
let created = await purchase({
  action: "runCreate",
  name: "Acceptance trip",
  charges: 464,
  items: [
    { productId: "a", packs: 2 },
    { productId: "b", packs: 1 },
  ],
});
let run = await P.runDetail(db, created.id);
equal(
  [run.estimate.units, run.estimate.knownSubtotal, run.estimate.total],
  [83, 10936, 11400],
  "E03 exact pack arithmetic",
);
equal(
  (await P.fundsProjection(db)).projected,
  38600,
  "projection subtracts selected plan once",
);
await purchase({
  action: "runStart",
  id: run.run.id,
  version: run.run.version,
});
run = await P.runDetail(db, run.run.id);
await purchase({
  action: "runSave",
  id: run.run.id,
  version: run.run.version,
  lines: run.lines.map((l) => ({
    id: l.id,
    state: "grabbed",
    packs: l.planned_packs,
    unitsPerPack: l.planned_pack_units,
    packPrice: l.planned_pack_price,
  })),
});
run = await P.runDetail(db, run.run.id);
const post = {
  requestId: id(),
  action: "runPurchase",
  id: run.run.id,
  version: run.run.version,
  lineIds: run.lines.map((l) => l.id),
  charges: 464,
  total: 11400,
  supplier: "Store",
  reference: "SYNTHETIC-1",
  purchasedAt: Date.now(),
  account: "cash",
  confirmed: true,
  chargesValidated: true,
};
const posted = await purchase(post);
await purchase(post);
equal(
  sqlite.prepare("SELECT count(*) n FROM purchase_receipts").get().n,
  1,
  "purchase retry does not duplicate receipt",
);
equal(
  sqlite
    .prepare(
      "SELECT count(*) n FROM money_movements WHERE source_type='receipt'",
    )
    .get().n,
  1,
  "one activity-account outflow",
);
equal(
  sqlite.prepare("SELECT stock FROM products WHERE id='a'").get().stock,
  0,
  "purchase does not put stock on shelf",
);
equal(
  (await M.moneySummary(db)).funds,
  38600,
  "activity purchase reduces recorded estimate once",
);
equal(
  (await P.fundsProjection(db)).projected,
  38600,
  "paid run removes all purchased quantities from future spend",
);
let receiptLines = sqlite
  .prepare("SELECT * FROM purchase_lines WHERE receipt_id=? ORDER BY id")
  .all(posted.receiptId);
equal(
  receiptLines.reduce((n, l) => n + l.total_cost, 0),
  11400,
  "allocated cents sum to receipt",
);
const a = receiptLines.find((l) => l.product_id === "a"),
  receive = {
    requestId: id(),
    action: "purchaseReceive",
    receiptId: posted.receiptId,
    lines: [{ id: a.id, version: a.version, qty: 24 }],
  };
await purchase(receive);
await purchase(receive);
equal(
  sqlite.prepare("SELECT stock FROM products WHERE id='a'").get().stock,
  24,
  "partial receipt and retry change stock once",
);
equal(
  (await P.runDetail(db, run.run.id)).run.stage,
  "purchased",
  "partial receipt remains incoming",
);
receiptLines = sqlite
  .prepare("SELECT * FROM purchase_lines WHERE receipt_id=?")
  .all(posted.receiptId);
await purchase({
  action: "purchaseReceive",
  receiptId: posted.receiptId,
  lines: receiptLines.map((l) => ({
    id: l.id,
    version: l.version,
    qty: l.qty - l.received_qty,
  })),
});
equal(
  (await P.runDetail(db, run.run.id)).run.stage,
  "completed",
  "all items received completes run",
);
equal(
  sqlite
    .prepare(
      "SELECT SUM(total_cost) n FROM stock_receipt_links WHERE purchase_line_id=?",
    )
    .get(a.id).n,
  a.total_cost,
  "partial receipt rounding retains every cent",
);
const facts = await H.productPerformance(db, "a");
equal(
  facts.restockSpending,
  500 + a.total_cost,
  "both legacy/direct and run receipts included once",
);
await reject(() => purchase({ ...post, requestId: id() }));
await reject(() => purchase({ ...post, total: 1 }));
await reject(() =>
  purchase({
    action: "purchaseReceive",
    receiptId: posted.receiptId,
    lines: [{ id: a.id, version: 0, qty: 1 }],
  }),
);
const allocations = Maths.allocateReceipt([8986, 1950], 464);
equal(
  allocations.reduce((n, l) => n + l.total, 0),
  11400,
  "largest remainder exact",
);
equal(
  Maths.estimateRun(
    [
      {
        planned_packs: 2,
        planned_pack_units: 24,
        planned_pack_price: 4600,
        price_at: Date.now(),
        price_kind: "quote",
      },
      {
        planned_packs: 1,
        planned_pack_units: 35,
        planned_pack_price: 1950,
        price_at: Date.now(),
        price_kind: "purchase",
      },
    ],
    null,
  ).knownSubtotal,
  11150,
  "updated shopping price arithmetic",
);
const missing = await purchase({
  action: "runCreate",
  name: "Missing costs",
  items: [
    { productId: "a", packs: 1 },
    { productId: "c", packs: 1 },
  ],
});
let md = await P.runDetail(db, missing.id);
equal(
  [md.estimate.complete, md.estimate.total, md.estimate.priced],
  [false, null, 1],
  "unknown is not free",
);
await purchase({
  action: "runSave",
  id: missing.id,
  version: md.run.version,
  lines: [
    {
      id: md.lines.find((l) => l.product_id === "c").id,
      state: "skipped",
      packPrice: null,
      packs: 1,
      unitsPerPack: 1,
    },
  ],
});
md = await P.runDetail(db, missing.id);
await reject(() =>
  purchase({ action: "runStart", id: missing.id, version: 0 }),
);
// Personal purchase creates a payable; later settlement is not a second expense.
const personal = await purchase({
  action: "runCreate",
  name: "Personal exception",
  charges: 0,
  items: [{ productId: "b", packs: 1 }],
});
let pd = await P.runDetail(db, personal.id);
await purchase({
  action: "runStart",
  id: personal.id,
  version: pd.run.version,
});
pd = await P.runDetail(db, personal.id);
await purchase({
  action: "runSave",
  id: personal.id,
  version: pd.run.version,
  lines: [
    {
      id: pd.lines[0].id,
      state: "grabbed",
      packs: 1,
      unitsPerPack: 35,
      packPrice: 1950,
    },
  ],
});
pd = await P.runDetail(db, personal.id);
const pp = await purchase({
  action: "runPurchase",
  id: personal.id,
  version: pd.run.version,
  lineIds: [pd.lines[0].id],
  charges: 0,
  total: 1950,
  supplier: "Store",
  reference: "SYNTHETIC-2",
  purchasedAt: Date.now(),
  funding: "personal",
  purchaser: "Synthetic shopper",
  confirmed: true,
  chargesValidated: true,
  receiveNow: true,
});
equal(
  (await M.moneySummary(db)).held,
  1950,
  "personal purchase reserves payable only",
);
equal(
  (await M.moneySummary(db)).funds,
  38600,
  "no activity funds leave at personal purchase",
);
const settle = {
  requestId: id(),
  action: "moneySettle",
  receiptId: pp.receiptId,
  amount: 1950,
  account: "cashapp",
  reference: "Synthetic reimbursement",
  effectiveAt: Date.now(),
};
await money(settle);
await money(settle);
equal((await M.moneySummary(db)).funds, 36650, "one settlement outflow");
equal((await M.moneySummary(db)).held, 0, "settled payable removed");
equal(
  sqlite.prepare("SELECT SUM(amount) n FROM expenses WHERE kind='stock'").get()
    .n,
  13350,
  "expense counted once across both purchases",
);
const transfer = {
  requestId: id(),
  action: "moneyTransfer",
  from: "cashapp",
  to: "cash",
  amount: 10000,
  effectiveAt: Date.now(),
  reference: "Synthetic transfer",
};
await money(transfer);
await money(transfer);
equal(
  (await M.moneySummary(db)).funds,
  36650,
  "transfer changes composition only",
);
// Included payment is confirmed after a balance check without a duplicate inflow.
sqlite
  .prepare(
    "INSERT INTO payments(id,fingerprint,member_id,purpose,method,amount,created_at) VALUES('late','synthetic','member','topup','cash',500,?)",
  )
  .run(t);
let account = (await M.moneySummary(db)).accounts.find((a) => a.id === "cash");
await money({
  action: "moneyCheck",
  accounts: [
    {
      account: "cash",
      amount: account.balance + 500,
      observedAt: Date.now(),
      previousId: account.observation_id,
      ledgerComplete: true,
      note: "Includes known pending receipt",
      includedPayments: ["late"],
    },
  ],
});
const counted = (await M.moneySummary(db)).funds;
await S.mutate(db, user, {
  action: "verify",
  requestId: id(),
  id: "late",
  confirmed: true,
  amountReceived: 500,
  expectedCredit: 500,
  effectiveAt: t,
});
equal(
  (await M.moneySummary(db)).funds,
  counted,
  "E07 late confirmation already included in count is excluded",
);
equal(
  sqlite.prepare("SELECT credit FROM members WHERE id='member'").get().credit,
  725,
  "only actual confirmation changes member credit",
);
// Complete product editor publishes in one operation and never writes old stock.
const productId = id(),
  productBody = {
    action: "saveProduct",
    requestId: id(),
    id: productId,
    create: true,
    name: "New snack",
    category: "Snacks",
    detail: "Small",
    price: 201,
    taxBp: 0,
    openingStock: 9,
    reorder: 2,
    active: true,
    purchase: { supplier: "Store", unitsPerPack: 6, packPrice: 500 },
  };
await S.mutate(db, user, productBody);
await S.mutate(db, user, productBody);
equal(
  sqlite
    .prepare("SELECT price,stock,active FROM products WHERE id=?")
    .get(productId),
  { price: 225, stock: 9, active: 1 },
  "one product priced and published",
);
const p = sqlite.prepare("SELECT * FROM products WHERE id=?").get(productId);
hooks.beforeBatch = () =>
  sqlite.prepare("UPDATE products SET stock=stock-1 WHERE id=?").run(productId);
await S.mutate(db, user, {
  ...productBody,
  requestId: id(),
  create: false,
  version: p.version,
  name: "Renamed",
  purchase: undefined,
});
equal(
  sqlite.prepare("SELECT stock FROM products WHERE id=?").get(productId).stock,
  8,
  "concurrent purchase is not overwritten by metadata save",
);
await reject(() =>
  S.mutate(db, user, {
    ...productBody,
    id: id(),
    requestId: id(),
    price: null,
  }),
);
equal(
  sqlite.prepare("SELECT debt FROM members WHERE id='member'").get().debt,
  775,
  "existing debt preserved",
);
// A direct receipt uses the same canonical records and funding path as a run.
const direct = {
  action: "purchaseDirect",
  requestId: id(),
  items: [{ productId: "c", packs: 2, unitsPerPack: 3, packPrice: 450 }],
  charges: 51,
  total: 951,
  supplier: "Direct store",
  reference: "DIRECT-SYNTHETIC",
  purchasedAt: Date.now(),
  account: "cash",
  confirmed: true,
  chargesValidated: true,
  receiveNow: true,
};
const directResult = await purchase(direct);
await purchase(direct);
equal(
  sqlite.prepare("SELECT stock FROM products WHERE id='c'").get().stock,
  9,
  "direct receipt and retry add six units once",
);
equal(
  sqlite
    .prepare("SELECT count(*) n FROM purchase_lines WHERE receipt_id=?")
    .get(directResult.receiptId).n,
  1,
  "one canonical direct receipt",
);
const directLine = sqlite
  .prepare("SELECT * FROM purchase_lines WHERE receipt_id=?")
  .get(directResult.receiptId);
const returnBody = {
  action: "purchaseCorrect",
  requestId: id(),
  lineId: directLine.id,
  version: directLine.version,
  kind: "return",
  qty: 1,
  stockQty: 1,
  refund: 150,
  account: "cash",
  reason: "Synthetic documented return",
};
await purchase(returnBody);
await purchase(returnBody);
equal(
  sqlite.prepare("SELECT stock FROM products WHERE id='c'").get().stock,
  8,
  "return removes stock once",
);
equal(
  (await H.productPerformance(db, "c")).restockSpending,
  801,
  "return reduces net purchase spending once",
);
await reject(() => purchase({ ...returnBody, requestId: id() }));
// A price for a different pack size is never silently reused.
const mismatch = await purchase({
  action: "runCreate",
  name: "Changed pack size",
  items: [{ productId: "a", unitsPerPack: 12, packs: 1 }],
});
equal(
  (await P.runDetail(db, mismatch.id)).estimate.total,
  null,
  "mismatched pack price is missing",
);
const stale = Maths.estimateRun(
  [
    {
      planned_packs: 1,
      planned_pack_units: 24,
      planned_pack_price: 100,
      price_at: Date.now() - 31 * 86400000,
      price_kind: "default",
    },
  ],
  0,
);
equal(stale.stale, 1, "stale quote is flagged");
await reject(() => purchase({ ...direct, requestId: id(), total: 1 }));
await reject(() => purchase({ ...direct, requestId: id(), account: "" }));
await reject(() =>
  purchase({ ...direct, requestId: id(), chargesValidated: false }),
);
const zero = await purchase({
  ...direct,
  requestId: id(),
  items: [{ productId: "c", packs: 1, unitsPerPack: 1, packPrice: 0 }],
  charges: 0,
  total: 0,
  reference: "Free sample",
});
equal(
  sqlite
    .prepare("SELECT total FROM purchase_receipts WHERE id=?")
    .get(zero.receiptId).total,
  0,
  "explicit free sample remains distinct from unknown cost",
);
// Shopping/receiving race guards roll back all dependent financial writes.
const raceBefore = sqlite
  .prepare("SELECT COUNT(*) n FROM purchase_receipts")
  .get().n;
hooks.beforeBatch = () =>
  sqlite
    .prepare("UPDATE products SET stock=stock+1,version=version+1 WHERE id='c'")
    .run();
await reject(() => purchase({ ...direct, requestId: id() }));
equal(
  sqlite.prepare("SELECT COUNT(*) n FROM purchase_receipts").get().n,
  raceBefore,
  "concurrent stock change rolls back receipt, expense and funds",
);
const checksBefore = sqlite
  .prepare("SELECT COUNT(*) n FROM money_observations")
  .get().n;
await reject(() =>
  money({
    action: "moneyCheck",
    accounts: [
      {
        account: "cash",
        amount: 1,
        observedAt: Date.now(),
        previousId: "stale",
      },
    ],
  }),
);
equal(
  sqlite.prepare("SELECT COUNT(*) n FROM money_observations").get().n,
  checksBefore,
  "stale balance check leaves no record",
);
const latestCheck = sqlite
  .prepare(
    "SELECT id FROM money_observations WHERE account_id='cash' ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1",
  )
  .get();
hooks.beforeBatch = () =>
  sqlite
    .prepare("UPDATE accounting_revision SET version=version+1 WHERE id='main'")
    .run();
await reject(() =>
  money({
    action: "moneyCheck",
    accounts: [
      {
        account: "cash",
        amount: 1,
        note: "Synthetic variance",
        observedAt: Date.now(),
        previousId: latestCheck.id,
      },
    ],
  }),
);
equal(
  sqlite.prepare("SELECT COUNT(*) n FROM money_observations").get().n,
  checksBefore,
  "concurrent financial change invalidates balance expectation",
);
equal(
  Maths.estimateRun(
    [
      {
        state: "needed",
        planned_packs: 2,
        planned_pack_units: 24,
        planned_pack_price: 4493,
        actual_packs: 3,
        actual_pack_units: 24,
        actual_pack_price: 4600,
        price_at: Date.now(),
        price_kind: "purchase",
      },
    ],
    0,
  ).total,
  13800,
  "shopping edits replace saved quantities before grabbed",
);
// One obligation and one selected forecast, including a partial purchase.
const plan = await purchase({
  action: "runCreate",
  name: "Split receipt trip",
  charges: 0,
  items: [
    { productId: "a", packs: 1 },
    { productId: "b", packs: 1 },
  ],
});
let split = await P.runDetail(db, plan.id);
const commitment = await money({
  action: "moneyCommitment",
  label: "Planned supplier order",
  kind: "supplier",
  amount: 6443,
  groupKey: "supplier-order-unique",
  runId: plan.id,
});
await reject(() =>
  money({
    action: "moneyCommitment",
    label: "Duplicate same obligation",
    kind: "prepaid",
    amount: 6443,
    groupKey: "supplier-order-unique",
  }),
);
const settings = sqlite
  .prepare("SELECT * FROM workflow_settings WHERE id='main'")
  .get();
await money({
  action: "moneySelectRun",
  runId: plan.id,
  version: settings.version,
});
equal(
  (await P.fundsProjection(db)).plan.remainingDeduction,
  0,
  "committed run is not deducted twice",
);
await purchase({ action: "runStart", id: plan.id, version: split.run.version });
split = await P.runDetail(db, plan.id);
await purchase({
  action: "runSave",
  id: plan.id,
  version: split.run.version,
  lines: split.lines.map((l) => ({
    id: l.id,
    state: "grabbed",
    packs: 1,
    unitsPerPack: l.planned_pack_units,
    packPrice: l.planned_pack_price,
  })),
});
split = await P.runDetail(db, plan.id);
await purchase({
  action: "runPurchase",
  id: plan.id,
  version: split.run.version,
  lineIds: [split.lines.find((l) => l.product_id === "a").id],
  charges: 0,
  total: 4493,
  supplier: "Store",
  reference: "SPLIT-1",
  purchasedAt: Date.now(),
  account: "cash",
  confirmed: true,
  chargesValidated: true,
});
equal(
  sqlite
    .prepare("SELECT amount,status FROM money_commitments WHERE id=?")
    .get(commitment.id),
  { amount: 1950, status: "open" },
  "partial purchase removes only paid portion from commitment",
);
equal(
  (await P.runDetail(db, plan.id)).estimate.knownSubtotal,
  1950,
  "only unpurchased items remain in forecast",
);
// More than twenty items are supported by bounded JSON batch statements.
for (let i = 0; i < 48; i++)
  sqlite
    .prepare(
      "INSERT INTO products(id,name,category,stock,price,tax_bp,active,cost) VALUES(?,?,'Snacks',0,100,0,1,10)",
    )
    .run("bulk-" + i, "Bulk " + i);
const bulk = await purchase({
  ...direct,
  requestId: id(),
  items: Array.from({ length: 48 }, (_, i) => ({
    productId: "bulk-" + i,
    packs: 1,
    unitsPerPack: 1,
    packPrice: 10,
  })),
  charges: 0,
  total: 480,
  reference: "BULK-48",
});
equal(
  sqlite
    .prepare("SELECT COUNT(*) n FROM purchase_lines WHERE receipt_id=?")
    .get(bulk.receiptId).n,
  48,
  "48-item receipt posted atomically",
);
equal(
  sqlite
    .prepare("SELECT SUM(stock) n FROM products WHERE id LIKE 'bulk-%'")
    .get().n,
  48,
  "48-item stock batch completes",
);
let cursor,
  exported = [];
do {
  const page = await H.historyPage(db, admin, "runItems", {
    admin: true,
    limit: 7,
    cursor,
  });
  exported.push(...page.records);
  cursor = page.nextCursor;
} while (cursor);
equal(
  exported.filter((l) => l.run_id === bulk.id).length,
  48,
  "run item export paginates all items beyond first screen",
);
const Export = await f.module("lib/pilot/export");
check(
  Export.toCsv([{ reference: '=HYPERLINK("bad")', amount: 100 }]).includes(
    "'=HYPERLINK",
  ),
  "CSV escapes formula text",
);
// Cost repairs retain original sale snapshots and respect closed periods.
sqlite.exec(
  "INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,cost,status,created_at) VALUES('unknown-sale','UNKNOWN','unknown','member','Existing','tab',2000,0,NULL,'tab',1000); INSERT INTO order_items(id,order_id,product_id,name,qty,price,cost,tax_bp,preorder) VALUES('unknown-item','unknown-sale','c','Unknown price',5,400,NULL,0,0);",
);
let coverage = await H.productPerformance(db, "c");
equal(
  [coverage.stats.units, coverage.stats.sales, coverage.stats.unknownUnits],
  [5, 2000, 5],
  "unknown historical costs retain units and sales",
);
await purchase({
  action: "saleCostCorrect",
  itemId: "unknown-item",
  cost: 187,
  evidence: "Synthetic original supplier receipt",
});
equal(
  sqlite.prepare("SELECT cost FROM order_items WHERE id='unknown-item'").get()
    .cost,
  null,
  "cost correction does not rewrite original sale",
);
coverage = await H.productPerformance(db, "c");
equal(
  [coverage.stats.knownProfit, coverage.stats.unknownUnits],
  [1065, 0],
  "evidence repair adds exact cost coverage",
);
sqlite.exec(
  "INSERT INTO accounting_periods(month,status) VALUES('1970-01','closed');",
);
await reject(() =>
  money({
    action: "moneyExpense",
    account: "cash",
    amount: 100,
    kind: "morale",
    effectiveAt: 1000,
    reason: "Closed-period attempt",
  }),
);
sqlite.exec(readFileSync("WORKFLOW-SCHEMA.sql", "utf8"));
check(
  !sqlite.prepare("PRAGMA foreign_key_check").all().length,
  "rerun after closed period retains foreign-key integrity",
);
// Effective-date reports include a later-posted entry in its actual period.
await money({action:'moneyExpense',account:'cash',amount:100,kind:'morale',effectiveAt:Date.parse('2020-01-15T12:00:00Z'),reason:'Synthetic historical posting'});
equal((await M.moneyHistory(db,{kind:'movements',from:'2020-01-01',to:'2020-12-31'})).records.length,1,'annual export uses effective date independently of posting date');
// Manual new-member creation gets its own grant; existing accounts do not.
sqlite.exec(readFileSync("IDENTITY-SCHEMA.sql", "utf8"));
const newMember = {
  action: "member",
  requestId: id(),
  name: "New approved member",
  email: "new-approved@gmail.com",
  debt: 0,
  credit: 0,
  tabLimit: 3000,
  active: true,
  snacks: true,
  gear: true,
};
const newPerson = await S.mutate(db, user, newMember);
await S.mutate(db, user, newMember);
equal(
  sqlite
    .prepare(
      "SELECT COUNT(*) n FROM identity_grants WHERE kind='bootstrap' AND member_id=? AND provider='google' AND status='pending'",
    )
    .get(newPerson.memberId).n,
  1,
  "manual new member gets one epoch-bound Google grant",
);
equal(
  sqlite
    .prepare("SELECT COUNT(*) n FROM identity_grants WHERE member_id='member'")
    .get().n,
  0,
  "old members gain no inferred login authority",
);
sqlite.close();
console.log(
  JSON.stringify({
    suite: "workflow",
    checks,
    storage: "isolated synthetic SQLite",
    migration: "all original rows preserved after two applications",
  }),
);
