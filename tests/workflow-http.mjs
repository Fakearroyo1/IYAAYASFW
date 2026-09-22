import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { workflowWorker } from "./workflow-worker.mjs";
const f = await workflowWorker();
let checks = 0;
const ok = (v, m) => {
    assert.ok(v, m);
    checks++;
  },
  id = () => crypto.randomUUID();
const post = (body, b = f.admin, extra = {}) =>
  f.request(b, "/api/workflows", { requestId: id(), ...body }, extra);
async function json(response, label) {
  const r = await response,
    j = await r.json();
  ok(r.status === 200, label + ": " + JSON.stringify(j));
  ok(
    r.headers.get("cache-control")?.includes("no-store"),
    label + " private response",
  );
  return j;
}
try {
  for (const view of ["catalog", "money", "runs", "purchaseOptions"]) {
    ok(
      (await f.request(f.member, "/api/workflows?view=" + view)).status === 403,
      "member cannot read " + view,
    );
    await json(
      f.request(f.admin, "/api/workflows?view=" + view),
      "admin " + view,
    );
  }
  ok(
    (await post({ action: "moneyCheck" }, f.member)).status === 403,
    "member cannot change funds",
  );
  ok(
    (
      await post({ action: "moneyCheck" }, f.admin, {
        Origin: "https://evil.test",
      })
    ).status === 403,
    "cross-origin request rejected",
  );
  ok(
    (
      await post({ action: "moneyCheck" }, f.admin, {
        "x-identity-csrf": "incorrect",
      })
    ).status === 403,
    "invalid CSRF rejected",
  );
  for (const host of ["auth.test.local", "register.test.local"])
    ok(
      [404, 405].includes(
        (await f.request({ ...f.admin, host }, "/api/workflows?view=money"))
          .status,
      ),
      "workflow API isolated from " + host,
    );
  await json(
    post({
      action: "moneyCheck",
      reviewer: "Synthetic second checker",
      accounts: [
        {
          account: "cash",
          amount: 20000,
          observedAt: Date.now() - 1000,
          ledgerComplete: true,
        },
        {
          account: "cashapp",
          amount: 30000,
          observedAt: Date.now() - 1000,
          ledgerComplete: true,
        },
      ],
    }),
    "record balance checks",
  );
  await json(
    post({
      action: "purchaseOption",
      productId: "drink",
      supplier: "Test store",
      unitsPerPack: 24,
      packPrice: 4493,
    }),
    "save pack option",
  );
  await json(
    post({
      action: "purchaseOption",
      productId: "snack",
      supplier: "Test store",
      unitsPerPack: 35,
      packPrice: 1950,
    }),
    "save other option",
  );
  const plan = await json(
    post({
      action: "runCreate",
      name: "HTTP shopping trip",
      charges: 464,
      items: [
        { productId: "drink", packs: 2 },
        { productId: "snack", packs: 1 },
      ],
    }),
    "save exact plan",
  );
  let run = await json(
    f.request(f.admin, "/api/workflows?view=run&id=" + plan.id),
    "read plan",
  );
  ok(
    run.estimate.total === 11400 && run.estimate.units === 83,
    "compiled estimate matches acceptance arithmetic",
  );
  await json(
    post({ action: "runStart", id: plan.id, version: run.run.version }),
    "start shopping",
  );
  run = await (
    await f.request(f.admin, "/api/workflows?view=run&id=" + plan.id)
  ).json();
  await json(
    post({
      action: "runSave",
      id: plan.id,
      version: run.run.version,
      lines: run.lines.map((l) => ({
        id: l.id,
        state: "grabbed",
        packs: l.planned_packs,
        unitsPerPack: l.planned_pack_units,
        packPrice: l.planned_pack_price,
      })),
    }),
    "save grabbed quantities",
  );
  run = await (
    await f.request(f.admin, "/api/workflows?view=run&id=" + plan.id)
  ).json();
  const body = {
    action: "runPurchase",
    requestId: id(),
    id: plan.id,
    version: run.run.version,
    lineIds: run.lines.map((l) => l.id),
    charges: 464,
    total: 11400,
    supplier: "Test store",
    reference: "HTTP-RECEIPT",
    purchasedAt: Date.now(),
    funding: "activity",
    account: "cashapp",
    confirmed: true,
    chargesValidated: true,
    receiveNow: false,
  };
  const first = await json(post(body), "record purchased goods");
  await json(post(body), "retry purchase");
  ok(
    (await f.one("SELECT COUNT(*) n FROM purchase_receipts")).n === 1,
    "HTTP retry produces one receipt",
  );
  const snapshot = await (
    await f.request(f.admin, "/api/workflows?view=run&id=" + plan.id)
  ).json();
  const receive = {
    action: "purchaseReceive",
    receiptId: first.receiptId,
    lines: snapshot.purchaseLines.map((l) => ({
      id: l.id,
      version: l.version,
      qty: l.qty,
    })),
  };
  const concurrent = await Promise.all([post(receive), post(receive)]);
  ok(
    concurrent.filter((r) => r.status === 200).length === 1 &&
      concurrent.filter((r) => r.status === 409).length === 1,
    "two receivers cannot double stock",
  );
  ok(
    (await f.one("SELECT stock FROM products WHERE id='drink'")).stock === 68,
    "stock increased by 48 once",
  );
  const summary = await json(
    f.request(f.admin, "/api/workflows?view=money"),
    "funds after receiving",
  );
  ok(
    summary.funds === 38600 && summary.projected === 38600,
    "stocking makes no second funds deduction",
  );
  for (const dataset of ["runItems", "receipts", "moneyMovements"]) {
    const r = await f.request(f.admin, "/api/export?dataset=" + dataset),
      csv = await r.text();
    ok(
      r.status === 200 &&
        csv.length > 60 &&
        r.headers.get("cache-control").includes("no-store"),
      "complete protected " + dataset + " export",
    );
  }
  const newProduct=id();
  const productBody={action:'saveProduct',requestId:id(),id:newProduct,create:true,version:-1,name:'Complete workflow snack',category:'Snacks',price:201,taxBp:0,openingStock:5,active:true,reorder:2,purchase:{supplier:'Synthetic supplier',unitsPerPack:12,packPrice:1200}};
  await json(f.request(f.admin,'/api/pilot',productBody),'create price and publish snack');await json(f.request(f.admin,'/api/pilot',productBody),'retry product creation');
  const checkout={action:'order',id:id(),method:'tab',items:[{id:newProduct,qty:1,price:225}]};await json(f.request(f.member,'/api/pilot',checkout),'member buys newly published product');await json(f.request(f.member,'/api/pilot',checkout),'member checkout retry');
  ok((await f.one('SELECT stock FROM products WHERE id=?',newProduct)).stock===4,'new product checkout consumes stock once');
  const memberBefore = await f.one(
    "SELECT debt,credit FROM members WHERE id='member'",
  );
  const created = await f.request(f.admin, "/api/pilot", {
    action: "member",
    requestId: id(),
    name: "New approved",
    email: "new-approved@gmail.com",
    debt: 0,
    credit: 0,
    tabLimit: 3000,
    active: true,
    snacks: true,
    gear: true,
  });
  const person = await created.json();
  ok(created.status === 200, "manual member creation via compiled route");
  ok(
    (
      await f.one(
        "SELECT COUNT(*) n FROM identity_grants WHERE member_id=? AND kind='bootstrap' AND provider='google' AND status='pending'",
        person.memberId,
      )
    ).n === 1,
    "new member Google grant stored through HTTP",
  );
  assert.deepEqual(
    await f.one("SELECT debt,credit FROM members WHERE id='member'"),
    memberBefore,
  );
  checks++;
  const roster = await f.request(f.admin, "/identity/api", {
      action: "adminRead",
      query: "New approved",
    }),
    rosterBody = await roster.json();
  ok(
    rosterBody.members[0].readiness === "Google ready",
    "new Gmail member readiness is actionable",
  );
  // The server paginates the entire roster, including readiness filtering.
  for (let i = 0; i < 62; i++)
    await f.run(
      "INSERT INTO members(id,email,name,role) VALUES(?,?,?,'member')",
      "page-" + i,
      "page-" + i + "@example.test",
      "Paged member " + String(i).padStart(2, "0"),
    );
  const list1 = await (
    await f.request(f.admin, "/identity/api", {
      action: "adminRead",
      query: "Paged member",
      readiness: "Invitation needed",
    })
  ).json();
  const list2 = await (
    await f.request(f.admin, "/identity/api", {
      action: "adminRead",
      query: "Paged member",
      readiness: "Invitation needed",
      offset: list1.nextOffset,
    })
  ).json();
  ok(
    list1.members.length === 50 &&
      list2.members.length === 12 &&
      new Set([...list1.members, ...list2.members].map((x) => x.id)).size ===
        62,
    "all matching members reachable without duplicate pages",
  );
  // Expiring the real application session denies new writes with no financial effects.
  await f.run(
    "UPDATE auth_sessions SET expires_at=? WHERE member_id='owner'",
    Date.now() - 1,
  );
  ok(
    (
      await post({
        action: "moneyTransfer",
        from: "cash",
        to: "cashapp",
        amount: 100,
        effectiveAt: Date.now(),
        reference: "Expired",
      })
    ).status === 401,
    "expired session cannot write",
  );
  ok(f.outbound() === 0, "no production or provider traffic");
  const report = {
    suite: "workflow-http",
    checks,
    runtime: "actual compiled Worker, disposable D1/R2",
    providers: "synthetic",
    passedAt: new Date().toISOString(),
  };
  writeFileSync(
    ".sites-runtime/workflow-http-evidence.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await f.close();
}
