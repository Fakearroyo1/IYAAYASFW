import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { testPng } from "./png-fixture.mjs";
const out = path.resolve(".sites-runtime/rounds57-tests");
for (const f of fs
  .readdirSync("lib", { recursive: true })
  .filter((f) => f.endsWith(".ts"))) {
  const dest = path.join(out, "lib", f.replace(/\.ts$/, ".mjs"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(
    dest,
    ts
      .transpileModule(fs.readFileSync(path.join("lib", f), "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      })
      .outputText.replace(/from (["'])(\.{1,2}\/[^"']+)\1/g, 'from "$2.mjs"'),
  );
}
fs.writeFileSync(
  out + "/lib/pilot/owner.mjs",
  "export const OWNER_EMAIL='owner@example.test';",
);
const { mutateGuest, guestAdmin } = await import(out + "/lib/pilot/guest.mjs");
const {
  codeHash,
  receiptHash,
  sessionFor,
  campaignCatalog,
  publicCatalog,
  signedToken,
  verifiedToken,
  shippingQuote,
  validateAddress,
} = await import(out + "/lib/guest/common.mjs");
const { guestQuote, submitGuestOrder, guestReceipt, expireGuestOrders } =
  await import(out + "/lib/guest/orders.mjs");
const {
  mutateInventory,
  inventoryRows,
  monthReport,
  recommendation,
  countPriority,
} = await import(out + "/lib/pilot/autopilot.mjs");
const { mutateRewards, rewardsPage, rewardTotal } = await import(
  out + "/lib/pilot/rewards.mjs"
);
const {
  verifyPayment,
  applyCredit,
  transactionDetail,
  correctionAmounts,
  correctTransaction,
} = await import(out + "/lib/pilot/transactions.mjs");
const { batchAtomic } = await import(out + "/lib/pilot/core.mjs");
const { safePng } = await import(out + "/lib/profile/png.mjs");
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const f of [
  "drizzle/0000_tiny_shape.sql",
  "drizzle/0001_absent_guardsmen.sql",
  "AUTH-SCHEMA.sql",
  "PRODUCT-SCHEMA.sql",
  "SECURITY-SCHEMA.sql",
  "BETA-SCHEMA.sql",
  "ROUNDS-SCHEMA.sql",
])
  sqlite.exec(fs.readFileSync(f, "utf8"));
const run = (sql, ...v) => sqlite.prepare(sql).run(...v),
  get = (sql, ...v) => sqlite.prepare(sql).get(...v);
class S {
  constructor(sql, v = []) {
    this.sql = sql;
    this.v = v;
  }
  bind(...v) {
    return new S(this.sql, v);
  }
  async first() {
    return get(this.sql, ...this.v) || null;
  }
  async all() {
    return { results: sqlite.prepare(this.sql).all(...this.v) };
  }
  async run() {
    const r = run(this.sql, ...this.v);
    return { meta: { changes: r.changes } };
  }
}
const db = {
  prepare: (sql) => new S(sql),
  batch: async (statements) => {
    sqlite.exec("BEGIN");
    try {
      const values = statements.map((s) => run(s.sql, ...s.v));
      sqlite.exec("COMMIT");
      return values;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  },
};
run("INSERT INTO settings(id,enabled,cashtag) VALUES('main',1,'$unit-test')");
for (const [id, role] of [
  ["owner", "admin"],
  ["member", "member"],
  ["other", "member"],
])
  run(
    "INSERT INTO members(id,user_id,email,name,role) VALUES(?,?,?,?,?)",
    id,
    id,
    id + "@example.test",
    id,
    role,
  );
const admin = get("SELECT * FROM members WHERE id='owner'"),
  member = get("SELECT * FROM members WHERE id='member'"),
  other = get("SELECT * FROM members WHERE id='other'");
run(
  "INSERT INTO products(id,name,category,price,cost,tax_bp,stock) VALUES('gear','Shirt','Gear',2000,1000,0,10),('snack','Bar','Snacks',100,50,0,10),('gear2','Hoodie','Gear',3000,1500,0,1)",
);
run(
  "INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,cost,status,created_at) VALUES('historic','HIST','hist','member','member','tab',100,0,50,'tab',1)",
);
run("UPDATE products SET active=1");
const before = JSON.stringify(sqlite.prepare("SELECT * FROM orders").all());
for (let i = 0; i < 2; i++)
  for (const f of [
    "GUEST-SCHEMA.sql",
    "AUTOPILOT-SCHEMA.sql",
    "REWARDS-SCHEMA.sql",
  ])
    sqlite.exec(fs.readFileSync(f, "utf8"));
let checks = 0;
const ok = (value, note) => {
    assert.ok(value, note);
    checks++;
  },
  bad = async (fn, re) => {
    await assert.rejects(fn, re);
    checks++;
  };
ok(
  JSON.stringify(sqlite.prepare("SELECT * FROM orders").all()) === before,
  "migration preserves historical orders",
);
ok((await rewardTotal(db, "member")) === 0, "no rewards backfill");
const body = (b) => ({ requestId: crypto.randomUUID(), ...b }),
  guest = (b) => mutateGuest(db, admin, body(b)),
  inventory = (b) => mutateInventory(db, admin, body(b)),
  reward = (b) => mutateRewards(db, admin, body(b));
await bad(
  () =>
    mutateGuest(
      db,
      member,
      body({
        action: "guestSettings",
        enabled: true,
        version: 0,
        reason: "Testing role enforcement",
      }),
    ),
  /administrator/,
);
await bad(
  () => mutateInventory(db, member, body({ action: "countCreate" })),
  /administrator/,
);
await bad(
  () =>
    mutateRewards(
      db,
      member,
      body({
        action: "rewardAward",
        memberId: "member",
        amount: 50,
        reason: "Not authorized",
      }),
    ),
  /administrator/,
);
await bad(
  () =>
    mutateGuest(
      db,
      admin,
      body({
        action: "guestSettings",
        enabled: true,
        version: 0,
        reason: "Missing admin MFA",
      }),
      "invalid-session",
    ),
  /changed/,
);
await guest({
  action: "guestSettings",
  enabled: true,
  version: 0,
  reason: "Open the test campaign",
});
await guest({
  action: "gearDelivery",
  productId: "gear",
  version: -1,
  pickup: true,
  shipping: true,
  firstCharge: 500,
  additionalCharge: 100,
});
const c = await guest({
    action: "guestCampaign",
    name: "Test campaign",
    startsAt: Date.now() - 60000,
    endsAt: Date.now() + 86400000,
    active: true,
    reservationHours: 24,
    items: [
      { productId: "gear", limit: 100 },
      { productId: "gear2", limit: 100 },
    ],
    pickupNote: "Unit store",
  }),
  cid = c.id;
const campaign = () => get("SELECT * FROM guest_campaigns WHERE id=?", cid);
const code = await guest({
  action: "guestCode",
  id: cid,
  version: campaign().version,
  reason: "Issue initial access",
});
ok(
  campaign().code_hash === (await codeHash(code.code)) &&
    campaign().code_hash !== code.code,
  "campaign code hash only",
);
ok(
  !JSON.stringify((await guestAdmin(db, {})).campaigns).includes(
    campaign().code_hash,
  ),
  "admin response excludes code hashes",
);
const sid = crypto.randomUUID();
run(
  "INSERT INTO guest_sessions(id,campaign_id,code_version,expires_at,created_at) VALUES(?,?,?,?,?)",
  sid,
  cid,
  campaign().code_version,
  Date.now() + 3600000,
  Date.now(),
);
const session = await sessionFor(db, { sid, cid }),
  key = "test-only-signing-material-".repeat(3),
  token = await signedToken(key, { scope: "campaign", sid, cid });
ok(
  (await verifiedToken(key, token, "campaign")).sid === sid,
  "signed session validates",
);
ok(
  !(await verifiedToken(key, token + "x", "campaign")),
  "tampered session rejected",
);
ok(!(await verifiedToken(key, token, "receipt")), "receipt scope isolated");
ok(
  !JSON.stringify(publicCatalog(await campaignCatalog(db, cid))).includes(
    "product_version",
  ),
  "catalog omits internal versions",
);
const selection = {
  items: [{ productId: "gear", qty: 2 }],
  delivery: "shipping",
};
ok(
  (await guestQuote(db, session, selection)).total === 4600,
  "server shipping: first plus additional",
);
await bad(
  () =>
    guestQuote(db, session, {
      ...selection,
      items: [{ productId: "snack", qty: 1 }],
    }),
  /no longer available/,
);
await bad(
  () =>
    guestQuote(db, session, {
      ...selection,
      items: [{ productId: "gear", qty: 11 }],
    }),
  /insufficient/,
);
assert.throws(
  () =>
    validateAddress({
      name: "A",
      line1: "1 Road",
      city: "APO",
      region: "AE",
      postal: "09000",
    }),
  /domestic/,
);
checks++;
ok(
  shippingQuote(
    [
      {
        key: "a",
        shipping: 1,
        price: 100,
        qty: 3,
        first_charge: 500,
        additional_charge: 100,
      },
    ],
    "shipping",
    { shipping_cap: 600 },
  ) === 600,
  "shipping cap",
);
const orderBody = body({
    ...selection,
    name: "Guest",
    email: "guest@example.test",
    method: "cash",
    paymentReported: true,
    expectedTotal: 4600,
    address: {
      name: "Guest",
      line1: "1 Main",
      city: "Fort Wayne",
      region: "IN",
      postal: "46802",
    },
  }),
  receipt = "A".repeat(48);
const order = await submitGuestOrder(db, session, orderBody, receipt);
ok(
  get("SELECT stock FROM products WHERE id='gear'").stock === 8,
  "stock reserved atomically",
);
ok(
  get("SELECT cost FROM orders WHERE id=?", order.orderId).cost === null,
  "unknown shipping cost does not overstate margin",
);
ok(
  get("SELECT receipt_hash FROM guest_orders WHERE order_id=?", order.orderId)
    .receipt_hash === (await receiptHash(receipt)),
  "receipt hash only",
);
ok(
  (await submitGuestOrder(db, session, orderBody, receipt)).replayed,
  "retries do not duplicate orders",
);
await bad(
  () =>
    submitGuestOrder(db, session, { ...orderBody, expectedTotal: 1 }, receipt),
  /identifier/,
);
await verifyPayment(
  db,
  admin,
  { id: order.orderId, confirmed: true },
  batchAtomic,
);
ok(
  get("SELECT state FROM guest_orders WHERE order_id=?", order.orderId)
    .state === "paid",
  "verified payment unlocks guest order",
);
await guest({
  action: "guestFulfill",
  id: order.orderId,
  version: get(
    "SELECT version FROM guest_orders WHERE order_id=?",
    order.orderId,
  ).version,
  state: "packing",
  reason: "Packing the paid order",
});
await bad(
  () =>
    guest({
      action: "guestFulfill",
      id: order.orderId,
      version: 2,
      state: "shipped",
      reason: "Missing tracking",
    }),
  /carrier/,
);
await guest({
  action: "guestFulfill",
  id: order.orderId,
  version: 2,
  state: "shipped",
  carrier: "USPS",
  tracking: "TEST123",
  reason: "Handed to carrier",
});
ok(
  (await guestReceipt(db, order.orderId)).order.tracking === "TEST123",
  "tracking available on own receipt",
);
const last = body({
  items: [{ productId: "gear2", qty: 1 }],
  delivery: "pickup",
  name: "Guest",
  email: "g@example.test",
  method: "cash",
  paymentReported: true,
  expectedTotal: 3000,
});
const race = await Promise.allSettled([
  submitGuestOrder(db, session, last, receipt),
  submitGuestOrder(
    db,
    session,
    { ...last, requestId: crypto.randomUUID() },
    receipt,
  ),
]);
ok(
  race.filter((x) => x.status === "fulfilled").length === 1,
  "only one last-stock order succeeds",
);
const pendingId = race.find((x) => x.status === "fulfilled").value.orderId;
run(
  "UPDATE guest_orders SET reservation_expires=? WHERE order_id=?",
  Date.now() - 1,
  pendingId,
);
await expireGuestOrders(db);
ok(
  get("SELECT stock FROM products WHERE id='gear2'").stock === 1,
  "expired pending reservation restores stock",
);
ok(
  get("SELECT status FROM orders WHERE id=?", pendingId).status === "void",
  "expiry preserves a corrected historical order",
);
await expireGuestOrders(db);
ok(
  get("SELECT stock FROM products WHERE id='gear2'").stock === 1,
  "expiry idempotent",
);
await guest({
  action: "guestCode",
  id: cid,
  version: campaign().version,
  reason: "Rotate access code",
});
await bad(() => sessionFor(db, { sid, cid }), /no longer available/);
await inventory({
  action: "inventoryPlan",
  productId: "snack",
  version: -1,
  vendor: "Warehouse",
  packSize: 12,
  leadDays: 7,
  targetDays: 21,
  safetyUnits: 20,
  reason: "Case pack from vendor",
});
const p = (await inventoryRows(db)).find((p) => p.product_id === "snack");
ok(p.suggested === 12, "recommendation rounds to case pack");
const restock = await inventory({
    action: "restockCreate",
    name: "Monday run",
    items: [{ productId: "snack", qty: 12 }],
  }),
  ri = get("SELECT * FROM restock_run_items WHERE run_id=?", restock.id);
await bad(
  () => inventory({ action: "restockReceive", id: restock.id, version: 0 }),
  /Check every/,
);
await inventory({
  action: "restockEdit",
  id: restock.id,
  version: 0,
  itemId: ri.id,
  qty: 12,
  totalCost: 1200,
  checked: true,
  reason: "",
});
const receive = body({
  action: "restockReceive",
  id: restock.id,
  version: 1,
  receipt: "Test receipt",
});
await mutateInventory(db, admin, receive);
await mutateInventory(db, admin, receive);
ok(
  get("SELECT stock,cost FROM products WHERE id='snack'").stock === 22,
  "receive once",
);
ok(
  get("SELECT cost FROM products WHERE id='snack'").cost === 77,
  "weighted average cost recorded",
);
ok(
  get("SELECT amount FROM expenses WHERE id=?", restock.id).amount === 1200,
  "one expense for restock",
);
const count = await inventory({ action: "countCreate", size: 3 }),
  countItems = sqlite
    .prepare("SELECT * FROM inventory_counts WHERE session_id=?")
    .all(count.id);
run("UPDATE products SET stock=stock-1 WHERE id='snack'");
await bad(
  () =>
    inventory({
      action: "countComplete",
      id: count.id,
      version: 0,
      items: countItems.map((c) => ({
        id: c.id,
        actual: c.expected,
        kind: "unexplained",
        reason: "",
      })),
    }),
  /changed/,
);
await inventory({
  action: "countCancel",
  id: count.id,
  version: 0,
  reason: "A purchase changed expected stock",
});
const count2 = await inventory({ action: "countCreate", size: 3 }),
  ci2 = sqlite
    .prepare("SELECT * FROM inventory_counts WHERE session_id=?")
    .all(count2.id);
await inventory({
  action: "countComplete",
  id: count2.id,
  version: 0,
  items: ci2.map((c, i) => ({
    id: c.id,
    actual: Math.max(0, c.expected - (i === 0 ? 1 : 0)),
    kind: "damage",
    reason: "One damaged item removed",
  })),
});
ok(
  get("SELECT status FROM count_sessions WHERE id=?", count2.id).status ===
    "completed",
  "counts record categorized variance",
);
function sale(id, memberId = "member", status = "tab", at = Date.now()) {
  run(
    "INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,cost,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    id,
    id,
    id,
    memberId,
    memberId,
    "tab",
    100,
    0,
    50,
    status,
    at,
  );
}
sale("new-a");
sale("new-b");
ok((await rewardTotal(db, "member")) === 5, "first daily purchase only");
run("UPDATE orders SET status='void' WHERE id='new-a'");
ok(
  (await rewardTotal(db, "member")) === 0,
  "void reverses automatic recognition",
);
sale("new-c");
ok((await rewardTotal(db, "member")) === 0, "void cannot farm daily cap");
run(
  "UPDATE members SET debt=100,credit=100,due_since=? WHERE id='member'",
  Date.now() - 86400000,
);
await applyCredit(
  db,
  get("SELECT * FROM members WHERE id='member'"),
  { id: crypto.randomUUID(), amount: 100 },
  batchAtomic,
);
ok(
  (await rewardTotal(db, "member")) === 10,
  "on-time full tab settlement earns recognition",
);
await reward({
  action: "rewardAward",
  memberId: "member",
  amount: 200,
  reason: "Recognize prior beta volunteer support",
});
ok(
  (await rewardTotal(db, "member")) === 210,
  "manual recognition preserves financial balance",
);
ok(
  get("SELECT debt FROM members WHERE id='member'").debt === 0,
  "points are separate from funds",
);
const badge = await reward({
    action: "badgeIssue",
    memberId: "member",
    badgeId: "founding-crew",
    reason: "Confirmed original beta participation",
  }),
  award = get("SELECT id FROM badge_awards WHERE member_id='member'");
await bad(
  () =>
    reward({
      action: "badgeIssue",
      memberId: "member",
      badgeId: "founding-crew",
      reason: "Duplicate badge attempt",
    }),
  /changed/,
);
const profileBody = body({
  action: "profileSave",
  version: -1,
  alias: "Test Crew",
  bio: "Supporting the unit",
  accent: "blue",
  theme: "classic",
  visible: true,
  boardOptIn: true,
  badges: [award.id],
});
await mutateRewards(db, member, profileBody);
ok(
  !(await rewardsPage(db, other, { kind: "rewards" })).board.length,
  "pending profile invisible",
);
await reward({
  action: "profileModerate",
  memberId: "member",
  version: 0,
  state: "approved",
  reason: "Reviewed alias and bio",
});
let board = (await rewardsPage(db, other, { kind: "rewards" })).board;
ok(board[0].title === "Snack Dump Chief", "rank one exact title");
ok(
  !JSON.stringify(board).includes("email") &&
    !JSON.stringify(board).includes("debt") &&
    !JSON.stringify(board).includes("member_id"),
  "board omits private data",
);
await reward({
  action: "profileModerate",
  memberId: "member",
  version: 1,
  state: "hidden",
  reason: "Temporary moderation review",
});
ok(
  !(await rewardsPage(db, other, { kind: "rewards" })).board.length,
  "hiding removes board immediately",
);
await reward({
  action: "badgeRevoke",
  id: award.id,
  reason: "Issuance correction for testing",
});
ok(
  !(await rewardsPage(db, member, { kind: "rewards" })).badges.length,
  "revoked badge disappears",
);
await reward({
  action: "rewardFreeze",
  memberId: "member",
  version: -1,
  frozen: true,
  reason: "Pause rule-based awards for review",
});
await bad(
  () =>
    reward({
      action: "rewardAward",
      memberId: "member",
      rule: "volunteer",
      source: "one-event",
      reason: "Volunteer contribution",
    }),
  /changed/,
);
assert.throws(
  () => run("UPDATE reward_ledger SET amount=999 WHERE member_id='member'"),
  /append-only/,
);
checks++;
const lastMonth = new Date();
lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
const month = lastMonth.toISOString().slice(0, 7),
  periodTime = Date.parse(month + "-05T12:00:00Z");
sale("past-order", "other", "tab", periodTime);
let report = await monthReport(db, month),
  checklist = Object.fromEntries(
    [
      "payments",
      "balances",
      "counts",
      "shrink",
      "cash",
      "cashapp",
      "adjustments",
    ].map((k) => [k, true]),
  );
await bad(
  () =>
    inventory({
      action: "monthClose",
      month,
      version: -1,
      revision: report.revision,
      checklist: {},
      cashOnHand: 100,
      cashappReference: "No receipts this month",
      reason: "Review complete",
    }),
  /every/,
);
await inventory({
  action: "monthClose",
  month,
  version: -1,
  revision: report.revision,
  checklist,
  cashOnHand: 100,
  cashappReference: "Test reconciliation record",
  reason: "All month-end checks reviewed",
});
assert.throws(
  () => run("UPDATE orders SET status='void' WHERE id='past-order'"),
  /Reopen/,
);
checks++;
assert.throws(
  () => run("UPDATE accounting_snapshots SET note='changed'"),
  /immutable/,
);
checks++;
await inventory({
  action: "monthReopen",
  month,
  version: 0,
  reason: "Correction found after month close",
});
run("UPDATE orders SET status='void' WHERE id='past-order'");
ok(
  get("SELECT COUNT(*) n FROM accounting_snapshots").n === 1,
  "reopening retains original snapshot",
);
await bad(
  () => safePng(new TextEncoder().encode("<svg onload=alert(1)>"), "avatar"),
  /valid photo/,
);

const clean = await safePng(testPng(), "avatar");
ok(clean.width === 2 && clean.height === 2, "valid PNG dimensions retained");
ok(
  !Buffer.from(clean.bytes).includes("private-test-metadata"),
  "PNG metadata stripped",
);
await bad(() => safePng(testPng({ width: 513 }), "avatar"), /valid photo/);
await bad(
  () => safePng(Buffer.concat([testPng(), Buffer.from("extra")]), "avatar"),
  /valid photo/,
);
const corrupt = testPng();
corrupt[20] ^= 1;
await bad(() => safePng(corrupt, "avatar"), /valid photo/);
await bad(
  () => safePng(testPng({ raw: Buffer.alloc(1000000) }), "avatar"),
  /valid photo/,
);
ok(
  Math.abs(
    recommendation({
      units: 30,
      lead_days: 1,
      target_days: 1,
      safety_units: 0,
      available: 1,
      pack_size: 1,
      price: 110,
      cost: 50,
      tax_bp: 1000,
      waste_units: 1,
    }).margin - 0.5,
  ) < 0.0001,
  "planning margin excludes inclusive tax",
);
ok(
  countPriority({
    units: 10,
    waste_units: 0,
    available: 10,
    cost: 100,
    last_count: 1,
  }) >
    countPriority({
      units: 10,
      waste_units: 0,
      available: 10,
      cost: 100,
      last_count: Date.now(),
    }),
  "stale counts receive priority",
);
ok(
  (await inventoryRows(db)).some((p) =>
    p.shrink.some(
      (s) => s.kind === "damage" && s.lost_units > 0 && s.known_loss_cost > 0,
    ),
  ),
  "shrink is reported by product and category",
);
const expiring = await reward({
  action: "badgeIssue",
  memberId: "other",
  badgeId: "product-scout",
  expiresAt: Date.now() + 120000,
  reason: "Time-limited campaign recognition",
});
run(
  "UPDATE badge_awards SET expires_at=? WHERE member_id='other'",
  Date.now() - 1,
);
ok(
  !(await rewardsPage(db, other, { kind: "rewards" })).badges.length,
  "expired badges are not displayed",
);
await reward({
  action: "badgeIssue",
  memberId: "other",
  badgeId: "product-scout",
  reason: "New participation after expiry",
});
ok(
  (await rewardsPage(db, other, { kind: "rewards" })).badges.length === 1,
  "expired award can be reissued with history retained",
);
await bad(
  () =>
    mutateRewards(
      db,
      other,
      body({
        action: "profileSave",
        version: -1,
        alias: "No unlock",
        bio: "Tier restricted",
        accent: "blue",
        theme: "classic",
        visible: false,
        boardOptIn: false,
        badges: [],
      }),
    ),
  /not unlocked/,
);
await reward({
  action: "profileModerate",
  memberId: "member",
  version: 2,
  state: "approved",
  reason: "Restoring a reviewed profile",
});
const historicalSeason = await reward({
    action: "seasonCreate",
    name: "Archive test",
    startsAt: 1735689600000,
    endsAt: 1743465600000,
  }),
  seasonId = get("SELECT id FROM reward_seasons WHERE name='Archive test'").id;
run(
  "INSERT INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at) VALUES('season-test','member',10,'manual','test','owner','Fixture only',1735776000000)",
);
await reward({
  action: "seasonArchive",
  id: seasonId,
  version: 0,
  reason: "Test immutable seasonal recognition",
});
ok(
  (await rewardsPage(db, other, { kind: "rewards", season: seasonId })).board[0]
    .points === 10,
  "season archive retains only in-period recognition",
);
await mutateRewards(
  db,
  member,
  body({
    action: "profileSave",
    version: 3,
    alias: "Test Crew",
    bio: "Supporting the unit",
    accent: "blue",
    theme: "classic",
    visible: false,
    boardOptIn: false,
    badges: [],
  }),
);
ok(
  !(await rewardsPage(db, other, { kind: "rewards", season: seasonId })).board
    .length,
  "opting out also hides archived standings",
);
await bad(
  () =>
    reward({
      action: "seasonArchive",
      id: seasonId,
      version: 1,
      reason: "Duplicate archive",
    }),
  /completed season/,
);
const manualEntry = get(
  "SELECT id FROM reward_ledger WHERE member_id='member' AND rule_id='manual' AND amount=200",
);
await reward({
  action: "rewardReverse",
  id: manualEntry.id,
  reason: "Recognition adjustment test",
});
await bad(
  () =>
    reward({
      action: "rewardReverse",
      id: manualEntry.id,
      reason: "Duplicate reversal",
    }),
  /already recorded/,
);
await reward({
  action: "rewardAward",
  memberId: "member",
  amount: 200,
  reason: "Restore sample recognition after reversal test",
});
await bad(
  () =>
    reward({
      action: "rewardAward",
      memberId: "other",
      rule: "event",
      reason: "Missing contribution reference",
    }),
  /valid text/,
);
for (let i = 0; i < 5; i++)
  await reward({
    action: "rewardAward",
    memberId: "other",
    rule: "event",
    source: "event-" + i,
    reason: "Participation reviewed by administrator",
  });
ok(
  get(
    "SELECT SUM(amount) total FROM reward_ledger WHERE member_id='other' AND rule_id='event'",
  ).total === 30,
  "administrator rule awards obey weekly cap",
);
await bad(
  () =>
    reward({
      action: "rewardAward",
      memberId: "other",
      rule: "event",
      source: "event-0",
      reason: "Duplicate event recognition",
    }),
  /already recorded/,
);

// Exercise refunds through the shared accounting path, including shipping.
run(
  "UPDATE guest_orders SET reservation_expires=? WHERE order_id=?",
  Date.now() - 1,
  order.orderId,
);
await expireGuestOrders(db);
ok(
  get("SELECT state FROM guest_orders WHERE order_id=?", order.orderId)
    .state === "shipped",
  "paid orders survive reservation expiry",
);
async function refundGuest(remaining = false, method = "cash") {
  const d = await transactionDetail(db, order.orderId),
    items = remaining
      ? d.items
          .filter((i) => i.remaining_qty > 0)
          .map((i) => ({ id: i.id, qty: i.remaining_qty, restock: false }))
      : [
          {
            id: d.items.find((i) => i.product_id === "gear").id,
            qty: 1,
            restock: true,
          },
        ];
  const amounts = correctionAmounts(d.order, d.items, items, d.member, 0);
  return correctTransaction(
    db,
    admin,
    body({
      id: order.orderId,
      revision: d.order.revision,
      items,
      refundMethod: method,
      confirmed: true,
      reason: "Guest return reviewed and refunded",
      expectedTotal: amounts.total,
      expectedDebtReduction: amounts.debtReduced,
      expectedReturn: amounts.toReturn,
    }),
    batchAtomic,
  );
}
await bad(() => refundGuest(false, "credit"), /Guests do not have credit/);
const stockBeforeReturn = get(
  "SELECT stock FROM products WHERE id='gear'",
).stock;
await refundGuest();
ok(
  get("SELECT stock FROM products WHERE id='gear'").stock ===
    stockBeforeReturn + 1,
  "confirmed guest return restores selected stock only",
);
ok(
  (await guestReceipt(db, order.orderId)).order.refunded === 2000,
  "guest receipt shows partial refund",
);
await refundGuest(true);
ok(
  (await guestReceipt(db, order.orderId)).order.refunded === 4600,
  "full guest refund includes shipping",
);
ok(
  get("SELECT state FROM guest_orders WHERE order_id=?", order.orderId)
    .state === "cancelled",
  "full correction cancels guest fulfillment while retaining history",
);
// A personalized preorder uses its option price and campaign cap without stock deduction.
run(
  "INSERT INTO products(id,name,category,price,cost,tax_bp,stock,active) VALUES('tape','Name tape','Gear',500,200,0,0,1)",
);
run(
  "INSERT INTO product_details(product_id,personalization_label,personalization_required,personalization_max) VALUES('tape','Last name',1,20)",
);
run(
  "INSERT INTO product_variants(id,product_id,label,price,cost,stock,preorder) VALUES('tape-ocp','tape','OCP',800,300,0,1)",
);
const pc = await guest({
  action: "guestCampaign",
  name: "Name tape order",
  startsAt: Date.now() - 1000,
  endsAt: Date.now() + 86400000,
  active: true,
  reservationHours: 24,
  items: [{ productId: "tape", optionId: "tape-ocp", limit: 2 }],
  pickupNote: "Unit store",
});
await guest({
  action: "guestCode",
  id: pc.id,
  version: 0,
  reason: "Personalized preorder test",
});
const psid = crypto.randomUUID();
run(
  "INSERT INTO guest_sessions(id,campaign_id,code_version,expires_at,created_at) VALUES(?,?,1,?,?)",
  psid,
  pc.id,
  Date.now() + 3600000,
  Date.now(),
);
const ps = await sessionFor(db, { sid: psid, cid: pc.id }),
  personal = {
    items: [
      {
        productId: "tape",
        optionId: "tape-ocp",
        qty: 2,
        personalization: "REED",
      },
    ],
    delivery: "pickup",
  };
await bad(
  () =>
    guestQuote(db, ps, {
      ...personal,
      items: [{ ...personal.items[0], personalization: "" }],
    }),
  /Last name/,
);
const pq = await guestQuote(db, ps, personal);
ok(pq.total === 1600, "preorder quote uses selected variant price");
const po = await submitGuestOrder(
  db,
  ps,
  body({
    ...personal,
    name: "Morgan",
    email: "g@example.test",
    method: "cash",
    paymentReported: true,
    expectedTotal: 1600,
  }),
  receipt,
);
ok(
  get("SELECT stock FROM product_variants WHERE id='tape-ocp'").stock === 0,
  "preorders do not deduct stocked quantities",
);
ok(
  (await guestReceipt(db, po.orderId)).items[0].personalization === "REED",
  "personalization captured on receipt",
);
await bad(
  () =>
    guestQuote(db, ps, {
      ...personal,
      items: [{ ...personal.items[0], qty: 1 }],
    }),
  /insufficient/,
);

console.log(
  "Rounds 5–7:",
  checks,
  "integrity, authorization, and workflow checks passed.",
);
// Optional disposable review data, generated by the real read models above.
if (process.env.ROADMAP_FIXTURE_FILE) {
  run("UPDATE members SET name='Morgan Reed' WHERE id='member'");
  run("UPDATE members SET name='Alex Rivera' WHERE id='other'");
  run("UPDATE members SET name='Store Administrator' WHERE id='owner'");
  await reward({
    action: "profileModerate",
    memberId: "member",
    version: get("SELECT version FROM member_profiles WHERE member_id='member'")
      .version,
    state: "approved",
    reason: "Sample review profile",
  });
  await reward({
    action: "badgeIssue",
    memberId: "member",
    badgeId: "helping-hands",
    reason: "Supported the autumn restock",
  });
  await reward({
    action: "rewardAward",
    memberId: "other",
    amount: 75,
    reason: "Sample community support",
  });
  await mutateRewards(
    db,
    other,
    body({
      action: "profileSave",
      version: -1,
      alias: "Rivera",
      bio: "Happy to help the unit",
      accent: "green",
      theme: "classic",
      visible: true,
      boardOptIn: true,
      badges: [],
    }),
  );
  await reward({
    action: "profileModerate",
    memberId: "other",
    version: 0,
    state: "approved",
    reason: "Sample profile reviewed",
  });
  await inventory({
    action: "restockCreate",
    name: "Weekend warehouse run",
    items: [
      { productId: "snack", qty: 12, reason: "Prepare for the unit event" },
    ],
  });
  const { autopilotPage } = await import(out + "/lib/pilot/autopilot.mjs");
  fs.writeFileSync(
    process.env.ROADMAP_FIXTURE_FILE,
    JSON.stringify({
      rewards: await rewardsPage(db, member, { kind: "rewards" }, true),
      guest: await guestAdmin(db, {}),
      inventory: await autopilotPage(db, { kind: "inventory" }),
      month: await autopilotPage(db, { kind: "month", month }),
    }),
  );
}
