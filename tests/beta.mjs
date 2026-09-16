import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const out = path.resolve(".sites-runtime/beta-tests");
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
  user = { userId: "buyer-user", email: "buyer@example.test" },
  other = { userId: "other-user", email: "other@example.test" };
let checks = 0;
const check = (ok, message) => {
  assert.ok(ok, message);
  checks++;
};
const send = (u, b) => mutate(db, u, { requestId: crypto.randomUUID(), ...b });
const me = (u) => identity(db, u);
const product = (id) =>
  db.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
const order = (method, id = "monster", qty = 1, price = 250, extra = {}) => ({
  action: "order",
  id: crypto.randomUUID(),
  method,
  items: [{ id, qty, price }],
  ...extra,
});
const post = async (u, b) =>
  mutateCommunity(db, await me(u), { requestId: crypto.randomUUID(), ...b });
const edit = async (u, changes) => {
  const m = await me(u);
  return send(owner, {
    action: "member",
    id: m.id,
    name: m.name,
    email: m.email,
    debt: m.debt,
    credit: m.credit,
    tabLimit: m.tab_limit,
    previousDebt: m.debt,
    previousCredit: m.credit,
    previousRole: m.role,
    controlsVersion: m.controls_version,
    reason: "Verified test adjustment",
    ...changes,
  });
};
await readState(db, owner);
for (const [id, category, price] of [
  ["monster", "Drinks", 250],
  ["coin", "Gear", 1000],
  ["water", "Drinks", 125],
]) {
  const p = await product(id);
  await send(owner, {
    action: "product",
    ...p,
    category,
    price,
    cost: 100,
    taxBp: id === "water" ? 700 : 0,
    stock: 100,
    previousStock: p.stock,
    version: p.version,
    reorder: 5,
    active: true,
    preorder: false,
    reason: "Test stock",
  });
}
await send(owner, {
  action: "settings",
  cashtag: "ExampleSupply",
  cashInstructions: "Cash box",
  enabled: true,
  reminderDays: 7,
});
for (const u of [user, other]) {
  await send(owner, {
    action: "member",
    name: u === user ? "Buyer" : "Other",
    email: u.email,
    debt: 0,
    credit: 0,
    tabLimit: 3000,
  });
  await me(u);
}
await edit(user, { debt: 1000, credit: 500 });
const initialStock = (await product("monster")).stock;
for (const method of ["cash", "cashapp"]) {
  await assert.rejects(() => send(user, order(method)), /Snack purchases/);
  checks++;
}
check(
  (await product("monster")).stock === initialStock,
  "Rejected payment method preserves inventory",
);
const split = order("tab", "monster", 2, 250, { creditAmount: 250 });
await send(user, split);
await send(user, split);
check(
  (await me(user)).debt === 1250 && (await me(user)).credit === 250,
  "Split credit/tab is exactly once and preserves old debt",
);
await send(user, order("credit"));
check(
  (await me(user)).debt === 1250 && (await me(user)).credit === 0,
  "Credit can buy while tab exists",
);
await assert.rejects(
  () => send(user, order("tab", "monster", 8)),
  /record changed/,
);
checks++;
await send(user, order("tab", "monster", 7));
check((await me(user)).debt === 3000, "Exact hard cap allowed");
await assert.rejects(() => send(user, order("tab")), /record changed/);
checks++;
await edit(user, { credit: 1000 });
const credit = {
  action: "creditSettlement",
  id: crypto.randomUUID(),
  amount: 1000,
};
await send(user, credit);
await send(user, credit);
check(
  (await me(user)).debt === 2000 && (await me(user)).credit === 0,
  "Credit settlement applied exactly once",
);
const report = {
  action: "payment",
  id: crypto.randomUUID(),
  purpose: "settlement",
  method: "cash",
  amount: 1000,
};
await send(user, report);
check(
  (await me(user)).debt === 2000,
  "Member report alone does not alter balances",
);
const confirmation = await send(owner, {
  action: "verify",
  id: report.id,
  confirmed: true,
  amountReceived: 2500,
  expectedCredit: 500,
});
check(
  confirmation.reference.startsWith("CASH-"),
  "Cash reference is generated",
);
check(
  (await me(user)).debt === 0 && (await me(user)).credit === 500,
  "Admin-confirmed excess becomes spendable credit",
);
const gear = order("cash", "coin", 1, 1000, { creditAmount: 250 });
await send(user, gear);
check(
  (await me(user)).credit === 250 && (await me(user)).debt === 0,
  "Gear cannot add tab debt",
);
const gearPayment = await db
  .prepare("SELECT * FROM payments WHERE id=?")
  .bind(gear.id)
  .first();
check(
  gearPayment.amount === 750 && gearPayment.status === "pending",
  "Only external remainder awaits review",
);
await send(owner, {
  action: "verify",
  id: gear.id,
  confirmed: true,
  amountReceived: 800,
  expectedCredit: 50,
});
check(
  (await me(user)).credit === 300,
  "Gear cash overpayment credits only after confirmation",
);
await assert.rejects(
  () => send(user, order("tab", "coin", 1, 1000)),
  /upfront/,
);
checks++;
await assert.rejects(
  () =>
    send(user, {
      ...order("tab"),
      items: [
        { id: "monster", qty: 1, price: 250 },
        { id: "coin", qty: 1, price: 1000 },
      ],
    }),
  /separately/,
);
checks++;
const guest = {
  ...order("cash", "coin", 1, 1000),
  action: "guestOrder",
  payer: "Guest One",
  confirmed: true,
};
await send(owner, guest);
await send(owner, guest);
check(
  (await db.prepare("SELECT * FROM orders WHERE id=?").bind(guest.id).first())
    .member_id === null,
  "Guest sale does not create an account",
);
await assert.rejects(
  () => send(user, { ...guest, id: crypto.randomUUID() }),
  /Administrator/,
);
checks++;
await assert.rejects(
  () => send(owner, { ...guest, id: crypto.randomUUID(), confirmed: false }),
  /Confirm receipt/,
);
checks++;
const unpaid = {
  ...guest,
  id: crypto.randomUUID(),
  confirmed: false,
  unsettled: true,
  reason: "Guest retrieving cash",
};
await send(owner, unpaid);
check(
  (await adminSummary(db)).guestOwed === 1000,
  "Guest override appears in receivables",
);
await send(owner, { action: "verify", id: unpaid.id, confirmed: true });
check(
  (await adminSummary(db)).guestOwed === 0,
  "Guest confirmation clears receivable",
);
const custom = {
  action: "guestOrder",
  id: crypto.randomUUID(),
  method: "cash",
  confirmed: true,
  items: [
    {
      custom: true,
      name: "One-off gear",
      category: "Gear",
      qty: 2,
      price: 500,
      cost: 200,
      taxBp: 0,
    },
  ],
};
await send(owner, custom);
check(
  (await transactionDetail(db, custom.id)).items[0].custom === 1,
  "Custom guest line is tracked without a fake product",
);
async function correct(id, qty, refundMethod = "credit", restock = true) {
  const d = await transactionDetail(db, id),
    selection = d.items
      .filter((i) => i.remaining_qty)
      .map((i) => ({
        id: i.id,
        qty: qty ?? i.remaining_qty,
        restock: restock && !i.custom && !i.preorder,
      }));
  const a = correctionAmounts(
    d.order,
    d.items,
    selection,
    d.member,
    d.payments.find((p) => p.status === "pending" && p.purpose === "purchase")
      ?.amount || 0,
  );
  const b = {
    action: "correctTransaction",
    id,
    revision: d.order.revision,
    items: selection,
    refundMethod,
    confirmed: true,
    reference: crypto.randomUUID(),
    reason: "Beta test correction",
    expectedTotal: a.total,
    expectedDebtReduction: a.debtReduced,
    expectedReturn: a.toReturn,
    requestId: crypto.randomUUID(),
  };
  return { result: await send(owner, b), body: b };
}
const newTab = order("tab");
await send(user, newTab);
const before = (await product("monster")).stock;
const c = await correct(newTab.id);
await send(owner, c.body);
check((await me(user)).debt === 0, "Unpaid sale reversal removes tab debt");
check(
  (await product("monster")).stock === before + 1,
  "Repeated reversal never restores stock twice",
);
check(
  (await db.prepare("SELECT * FROM orders WHERE id=?").bind(newTab.id).first())
    .total === 250,
  "Original purchase amount preserved",
);
check(
  (
    await db
      .prepare("SELECT * FROM order_items WHERE order_id=?")
      .bind(newTab.id)
      .first()
  ).qty === 1,
  "Original purchase quantity preserved",
);
await assert.rejects(() => correct(newTab.id), /already been voided/);
checks++;
const cashBefore = (await adminSummary(db)).received;
await correct(guest.id, undefined, "cash");
check(
  (await adminSummary(db)).received === cashBefore - 1000,
  "Cash refund reduces net receipts",
);
const taxSale = order("tab", "water", 3, 125);
await send(user, taxSale);
await correct(taxSale.id, 1, "credit", false);
let detail = await transactionDetail(db, taxSale.id);
check(
  detail.order.total === 250 && detail.order.tax === 17,
  "Partial corrections preserve cumulative tax rounding",
);
await correct(taxSale.id, 2, "credit", false);
detail = await transactionDetail(db, taxSale.id);
check(
  detail.order.total === 0 && detail.order.tax === 0,
  "Final correction leaves no tax remainder",
);
await edit(user, { credit: 250 });
const spending = await Promise.allSettled([
  send(user, order("credit")),
  send(user, order("credit")),
]);
check(
  spending.filter((r) => r.status === "fulfilled").length === 1 &&
    (await me(user)).credit === 0,
  "Concurrent credit purchases cannot double-spend",
);
const supplyState = await readState(db, user);
check(
  supplyState.settings.tabReminder === 2000 &&
    supplyState.settings.tabHardLimit === 3000,
  "Thresholds are supplied consistently",
);
await assert.rejects(
  () =>
    post(other, {
      action: "reviewSave",
      productId: "monster",
      rating: 5,
      body: "Unpurchased",
    }),
  /recorded purchase/,
);
checks++;
await post(user, {
  action: "reviewSave",
  productId: "monster",
  rating: 4,
  body: "Useful selection.",
});
let reviews = await communityPage(db, await me(user), {
  kind: "reviews",
  productId: "monster",
});
check(
  reviews.records.length === 1 && reviews.records[0].verified_purchase === 1,
  "Recorded purchaser can publish one verified review",
);
await post(user, {
  action: "reviewSave",
  productId: "monster",
  rating: 5,
  body: "Updated review.",
  version: reviews.mine.version,
});
reviews = await communityPage(db, await me(user), {
  kind: "reviews",
  productId: "monster",
});
check(
  reviews.records.length === 1 && reviews.summary.average === 5,
  "Review edits do not add duplicate ratings",
);
await post(user, {
  action: "requestCreate",
  shop: "snacks",
  title: "New snack request",
  body: "Please consider this item.",
});
const board = await communityPage(db, await me(user), {
    kind: "requests",
    shop: "snacks",
  }),
  request = board.records[0];
await post(user, { action: "vote", id: request.id, value: 1 });
await post(user, { action: "vote", id: request.id, value: -1 });
let requestPage = await communityPage(db, await me(user), {
  kind: "requests",
  shop: "snacks",
});
check(
  requestPage.records[0].likes === 0 && requestPage.records[0].dislikes === 1,
  "Changing a vote replaces it",
);
await edit(other, { snacks: false, gear: true });
await assert.rejects(
  async () =>
    communityPage(db, await me(other), { kind: "requests", shop: "snacks" }),
  /not available/,
);
checks++;
await assert.rejects(
  () => post(other, { action: "vote", id: request.id, value: 1 }),
  /not available/,
);
checks++;
await edit(user, { postingEnabled: false });
await assert.rejects(
  () =>
    post(user, {
      action: "requestCreate",
      shop: "snacks",
      title: "Blocked post",
    }),
  /disabled/,
);
checks++;
await post(owner, {
  action: "removePost",
  kind: "review",
  id: reviews.mine.id,
  version: reviews.mine.version,
  reason: "Moderation test removal",
});
reviews = await communityPage(db, await me(user), {
  kind: "reviews",
  productId: "monster",
});
check(
  reviews.records.length === 0,
  "Moderated review disappears from public board",
);
await post(owner, {
  action: "requestDecision",
  id: request.id,
  version: request.version,
  status: "accepted",
  note: "Added to the next shopping list.",
});
requestPage = await communityPage(db, await me(other), {
  kind: "requests",
  shop: "gear",
});
check(
  requestPage.records.length === 0,
  "Gear-only accounts never receive snack requests",
);
await post(owner, {
  action: "teamCreate",
  kind: "question",
  title: "Cash count follow-up",
  body: "Please review the latest count.",
});
const team = await communityPage(db, await me(owner), { kind: "team" }, true);
await post(owner, {
  action: "teamReply",
  id: team.records[0].id,
  body: "Reviewed.",
});
await post(owner, {
  action: "teamUpdate",
  id: team.records[0].id,
  version: 0,
  status: "resolved",
  pinned: false,
});
check(
  (await communityPage(db, await me(owner), { kind: "team" }, true)).records[0]
    .status === "resolved",
  "Admin team threads support resolution",
);
await assert.rejects(
  async () => communityPage(db, await me(user), { kind: "team" }),
  /Verified administrator/,
);
checks++;
const managedSale = order("tab");
await send(owner, {
  ...managedSale,
  action: "memberOrder",
  memberId: (await me(other)).id,
  items: [{ id: "coin", qty: 1, price: 1000 }],
  method: "cash",
  confirmed: true,
  reason: "Corrected member entry",
});
check(
  (await transactionDetail(db, managedSale.id)).order.member_id ===
    (await me(other)).id,
  "Admin member entry belongs to the correct member",
);
const beforeMigration = JSON.stringify(
  sqlite.prepare("SELECT * FROM members ORDER BY id").all(),
);
sqlite.exec(fs.readFileSync("BETA-SCHEMA.sql", "utf8"));
sqlite.exec(fs.readFileSync("BETA-SCHEMA.sql", "utf8"));
check(
  JSON.stringify(sqlite.prepare("SELECT * FROM members ORDER BY id").all()) ===
    beforeMigration,
  "Repeat migration does not rewrite balances or member records",
);
check(
  (await historyPage(db, await me(user), "ledger")).records.length > 0,
  "Members can review their balance history",
);
check(
  (await productPerformance(db, "monster")).stats.units >= 0,
  "Corrected performance remains consistent",
);
// Administration must use the buyer's balances, never the administrator's wallet.
await edit(user, { debt: 0, credit: 250, postingEnabled: true });
const adminBefore = await me(owner),
  managedTab = order("tab");
await send(owner, {
  ...managedTab,
  action: "memberOrder",
  memberId: (await me(user)).id,
  creditAmount: 125,
  reason: "Corrected member purchase",
});
check(
  (await me(user)).debt === 125 && (await me(user)).credit === 125,
  "Admin member sale applies split funding to buyer",
);
check(
  (await me(owner)).debt === adminBefore.debt &&
    (await me(owner)).credit === adminBefore.credit,
  "Admin wallet unchanged by on-behalf entry",
);
// Cancel a pending gear order funded partly by real credit.
await edit(user, { credit: 300 });
const splitGear = order("cash", "coin", 1, 1000, { creditAmount: 300 });
await send(user, splitGear);
const receiptsBefore = (await adminSummary(db)).received;
await correct(splitGear.id);
check(
  (await me(user)).credit === 300 && (await me(user)).debt === 125,
  "Pending gear cancellation restores only its paid credit",
);
check(
  (await adminSummary(db)).received === receiptsBefore,
  "Cancelling unconfirmed cash does not invent a cash refund",
);
check(
  (await transactionDetail(db, splitGear.id)).payments.find(
    (p) => p.purpose === "purchase",
  ).amount === 0,
  "Cancelled payment has no remaining balance",
);
// A stale screen and concurrent corrections cannot refund twice.
const concurrent = order("tab", "monster", 2);
await send(user, concurrent);
const d = await transactionDetail(db, concurrent.id),
  selection = d.items.map((i) => ({
    id: i.id,
    qty: i.remaining_qty,
    restock: true,
  })),
  amounts = correctionAmounts(d.order, d.items, selection, d.member, 0);
const reverse = {
  action: "correctTransaction",
  id: d.order.id,
  revision: d.order.revision,
  items: selection,
  refundMethod: "credit",
  confirmed: true,
  reason: "Concurrent reversal fixture",
  expectedTotal: amounts.total,
  expectedDebtReduction: amounts.debtReduced,
  expectedReturn: amounts.toReturn,
};
const stockBefore = (await product("monster")).stock;
const racing = await Promise.allSettled([
  send(owner, reverse),
  send(owner, reverse),
]);
check(
  racing.filter((r) => r.status === "fulfilled").length === 1 &&
    (await product("monster")).stock === stockBefore + 2,
  "Concurrent corrections restore stock once",
);
await assert.rejects(() => send(owner, reverse), /already been voided/);
checks++;
// An administrator must review a changed overpayment preview again.
const finalReport = {
  action: "payment",
  id: crypto.randomUUID(),
  purpose: "settlement",
  method: "cash",
  amount: 100,
};
await send(user, finalReport);
await assert.rejects(
  () =>
    send(owner, {
      action: "verify",
      id: finalReport.id,
      amountReceived: 200,
      expectedCredit: 0,
      confirmed: true,
    }),
  /balance changed/,
);
checks++;
check(
  (
    await db
      .prepare("SELECT status FROM payments WHERE id=?")
      .bind(finalReport.id)
      .first()
  ).status === "pending",
  "Stale confirmation preview leaves payment pending",
);
await send(owner, {
  action: "reject",
  id: finalReport.id,
  reason: "Disposable stale preview report",
});
// Losing the last eligible purchase removes its review from public ratings.
await correct(managedSale.id, undefined, "credit");
await send(other, order("cash", "coin", 1, 1000));
await assert.rejects(
  () =>
    post(other, {
      action: "reviewSave",
      productId: "coin",
      rating: 4,
      body: "Still pending",
    }),
  /recorded purchase/,
);
checks++;
const gearForReview = order("cash", "coin", 1, 1000);
await send(other, gearForReview);
await send(owner, { action: "verify", id: gearForReview.id, confirmed: true });
await post(other, {
  action: "reviewSave",
  productId: "coin",
  rating: 4,
  body: "Verified gear review.",
});
// Reverse the only remaining confirmed gear purchase.
await correct(gearForReview.id, undefined, "credit");
check(
  (
    await communityPage(db, await me(other), {
      kind: "reviews",
      productId: "coin",
    })
  ).records.length === 0,
  "Voided purchases cannot sustain a verified review",
);
// CSV includes effective values plus untouched original values and safe text.
const { exportRows, toCsv } = await import(out + "/export.mjs");
const corrected = await transactionDetail(db, taxSale.id);
const reportData = {
  products: [],
  admin: {
    orders: [corrected.order],
    items: corrected.items,
    payments: corrected.payments,
    members: [],
    events: [],
    ledger: [],
    corrections: corrected.adjustments,
  },
};
const itemExport = exportRows(reportData, "items"),
  purchaseExport = exportRows(reportData, "purchases");
check(
  itemExport[0].Quantity === 0 &&
    itemExport[0]["Original quantity"] === 3 &&
    purchaseExport[0]["Total USD"] === 0 &&
    purchaseExport[0]["Original total USD"] === 3.75,
  "CSV separates original and reversed sale values",
);
check(
  exportRows(reportData, "corrections").length === 2,
  "Each partial correction remains exportable",
);
check(
  toCsv([{ Note: "=1+1" }]).includes("'=1+1"),
  "New exports retain spreadsheet formula protection",
);
// Existing ledger balances reconcile after every supported money operation.
const wallet = await me(user),
  sum = await db
    .prepare(
      "SELECT SUM(debt_delta) debt,SUM(credit_delta) credit FROM balance_ledger WHERE member_id=?",
    )
    .bind(wallet.id)
    .first();
check(
  sum.debt === wallet.debt && sum.credit === wallet.credit,
  "Balance ledger reconciles to both current balances",
);
console.log(
  "Beta checkout, accounting, moderation, and preservation checks:",
  checks,
);
