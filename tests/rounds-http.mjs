// Real compiled Worker and disposable D1. No network traffic or production data.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { randomBytes, createHash } from "node:crypto";
import {
  grantFixtureMfa,
  challengeBindings,
  challengeService,
} from "./security-fixtures.mjs";
const require = createRequire(import.meta.url),
  { Miniflare } = require(
    require.resolve("miniflare", {
      paths: [require.resolve("wrangler/package.json")],
    }),
  );
const mf = new Miniflare({
  modules: [
    { type: "ESModule", path: resolve("dist/server/index.js") },
    ...readdirSync("dist/server", { recursive: true })
      .filter((p) => p.endsWith(".js") && p !== "index.js")
      .map((p) => ({ type: "ESModule", path: resolve("dist/server", p) })),
  ],
  modulesRoot: resolve("dist/server"),
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
  r2Buckets: ["BUCKET"],
  bindings: { ...challengeBindings, OWNER_EMAIL: "owner@example.test" },
  cf: false,
  outboundService: challengeService,
});
let checks = 0;
const check = (v, m) => {
  assert.ok(v, m);
  checks++;
};
try {
  const db = await mf.getD1Database("DB");
  for (const f of [
    "drizzle/0000_tiny_shape.sql",
    "drizzle/0001_absent_guardsmen.sql",
    "AUTH-SCHEMA.sql",
    "PRODUCT-SCHEMA.sql",
    "SECURITY-SCHEMA.sql",
    "BETA-SCHEMA.sql",
  "ROUNDS-SCHEMA.sql",
  ])
    await db.exec(
      readFileSync(f, "utf8")
        .replace(/--> statement-breakpoint/g, "")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  await db
    .prepare(
      "INSERT INTO settings(id,enabled,cashtag) VALUES('main',1,'ExampleSupply')",
    )
    .run();
  const cookies = {};
  for (const [id, role] of [
    ["owner", "admin"],
    ["locked", "admin"],
    ["buyer", "member"],
  ]) {
    await db
      .prepare(
        "INSERT INTO members(id,user_id,email,name,role) VALUES(?,?,?,?,?)",
      )
      .bind(id, id, id + "@example.test", id, role)
      .run();
    await db
      .prepare(
        "INSERT INTO auth_credentials(member_id,password_hash,updated_at) VALUES(?,?,?)",
      )
      .bind(id, "unusable-test-fixture", Date.now())
      .run();
    const token = randomBytes(32).toString("hex");
    await db
      .prepare(
        "INSERT INTO auth_sessions(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)",
      )
      .bind(
        createHash("sha256").update(token).digest("hex"),
        id,
        Date.now(),
        Date.now() + 3600000,
      )
      .run();
    cookies[id] = "__Host-supply-session=" + token;
  }
  await grantFixtureMfa(db, cookies.owner);
  const request = (cookie, body, path = "/api/pilot", headers = {}) =>
    mf.dispatchFetch("https://test.local" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        Origin: "https://test.local",
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const id = crypto.randomUUID(),
    payload = {
      action: "saveGear",
      requestId: crypto.randomUUID(),
      id,
      create: true,
      name: "Unit shirt",
      detail: "Cotton",
      description: "Fit notes",
      images: [],
      price: 2500,
      taxBp: 0,
      active: true,
      preorder: false,
      stock: 0,
      stockReason: "Opening fixture count",
      variants: [
        {
          label: "Medium",
          size: "M",
          color: "Black",
          price: null,
          stock: 2,
          active: true,
          preorder: false,
        },
        {
          label: "Large",
          size: "L",
          color: "Black",
          price: 3000,
          stock: 1,
          active: true,
          preorder: false,
        },
      ],
    };
  for (const who of ["buyer", "locked"])
    check(
      (await request(cookies[who], payload)).status === 403,
      who + " cannot save without admin MFA",
    );
  check(
    (await request("", payload)).status === 401,
    "Unauthenticated save blocked",
  );
  check(
    (
      await request(cookies.owner, payload, "/api/pilot", {
        Origin: "https://attacker.test",
      })
    ).status === 403,
    "Cross-origin editor save blocked",
  );
  let r = await request(cookies.owner, payload);
  const saved = await r.json();
  check(
    r.status === 200 && saved.productId === id,
    "Complete gear item publishes through actual protected route",
  );
  const get = async () => {
    const r = await request(
      cookies.owner,
      undefined,
      "/api/pilot?view=catalog",
    );
    return (await r.json()).products.find((p) => p.id === id);
  };
  let p = await get(),
    large = p.variants.find((v) => v.label === "Large");
  const order = {
    action: "order",
    id: crypto.randomUUID(),
    method: "cash",
    items: [{ id, variantId: large.id, qty: 1, price: 3000 }],
  };
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () =>
      request(cookies.buyer, { ...order, id: crypto.randomUUID() }),
    ),
  );
  check(
    concurrent.filter((r) => r.status === 200).length === 1,
    "Only one purchase receives last option unit",
  );
  check(
    (await get()).variants.find((v) => v.id === large.id).stock === 0,
    "Option stock never goes negative",
  );
  const edit = {
    ...payload,
    create: false,
    requestId: crypto.randomUUID(),
    version: p.version,
    variants: p.variants.map(({ stock, ...v }) => ({
      ...v,
      active: !!v.active,
      preorder: !!v.preorder,
    })),
    name: "Updated shirt",
  };
  r = await request(cookies.owner, edit);
  check(
    r.status === 200 &&
      (await get()).variants.find((v) => v.id === large.id).stock === 0,
    "Metadata editing preserves stock purchased after the form opened",
  );
  r = await request(cookies.owner, {
    ...edit,
    requestId: crypto.randomUUID(),
    name: "Stale editor",
  });
  check(
    r.status === 409 && (await get()).name === "Updated shirt",
    "Stale admin edit rolls back every field",
  );
  const many = {
    ...payload,
    id: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    description: "x".repeat(4900),
    variants: Array.from({ length: 80 }, (_, i) => ({
      label: String(i) + " " + "x".repeat(95),
      size: "x".repeat(29),
      color: "x".repeat(49),
      price: 2500,
      active: true,
      preorder: true,
      stock: 0,
    })),
  };
  check(
    JSON.stringify(many).length > 24000,
    "Large fixture actually exceeds member request bound",
  );
  r = await request(cookies.owner, many);
  const bulk = await r.json();
  check(
    r.status === 200,
    "Verified admin can atomically save an 80-option matrix: " +
      JSON.stringify(bulk),
  );
  check(
    (await request(cookies.buyer, many)).status === 413,
    "Larger payload limit is unavailable to members",
  );
  check(
    (await request(cookies.owner, { ...many, description: "x".repeat(64000) }))
      .status === 413,
    "Verified admin payload remains bounded",
  );
  check(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM product_variants WHERE product_id=?")
        .bind(many.id)
        .first()
    ).n === 80,
    "All matrix options saved in D1",
  );
  // Exercise the new routes on the compiled Worker, not just imported services.
  const ops = (who, body, suffix = '', headers = {}) => request(cookies[who] || '', body, '/api/operations' + suffix, headers);
  for (const kind of ['inbox', 'emailAdmin', 'initiatives&shop=gear&admin=true']) {
    check((await ops('buyer', undefined, '?kind=' + kind)).status === 403, 'Member blocked from ' + kind);
    check((await ops('locked', undefined, '?kind=' + kind)).status === 403, 'Unverified admin blocked from ' + kind);
  }
  check((await ops('', undefined, '?kind=email')).status === 401, 'Email request history requires a session');
  check((await ops('owner', undefined, '?kind=inbox')).status === 200, 'Verified admin inbox renders on D1');
  const emailBody = {action:'emailAdminRequest',memberId:'buyer',email:'updated@example.test',confirmEmail:'updated@example.test',requestId:crypto.randomUUID()};
  check((await ops('owner', emailBody, '', {Origin:'https://attacker.test'})).status === 403, 'Operations rejects cross-origin mutations');
  check((await ops('owner', {...emailBody,note:'x'.repeat(15000)})).status === 413, 'Operations limits body size');
  check((await ops('locked', emailBody)).status === 403, 'Email management requires current MFA');
  const created = await ops('owner', emailBody), emailId = (await created.json()).id;
  check(created.status === 200 && emailId, 'Admin can initiate verified-address workflow');
  const er = () => db.prepare('SELECT * FROM email_change_requests WHERE id=?').bind(emailId).first();
  const generated = await ops('owner', {action:'emailCode',id:emailId,version:0,requestId:crypto.randomUUID()}), code = (await generated.json()).code;
  check(generated.status === 200 && /^[a-f0-9]{32}$/.test(code), 'Strong one-time email code issued');
  const list = await ops('buyer',undefined,'?kind=email'), listing = await list.json();
  check(list.headers.get('Cache-Control')?.includes('no-store') && listing.records.length === 1 && !('code_hash' in listing.records[0]), 'Private history omits code material and cannot be cached');
  check((await ops('buyer',{action:'emailVerify',id:emailId,version:(await er()).version,code,requestId:crypto.randomUUID()})).status === 200, 'Member verifies new address through Worker');
  check((await ops('buyer',{action:'emailComplete',id:emailId,version:(await er()).version,requestId:crypto.randomUUID()})).status === 403, 'Member cannot approve own identity change');
  check((await ops('owner',{action:'emailApprove',id:emailId,version:(await er()).version,note:'Fixture identity confirmed',requestId:crypto.randomUUID()})).status === 200, 'Admin approval keeps policy sync separate');
  const complete = {action:'emailComplete',id:emailId,version:(await er()).version,note:'Fixture policy updated',identityChecked:true,newAddressAllowed:true,oldAddressRemoved:true,requestId:crypto.randomUUID()};
  const finished = await Promise.all([ops('owner',complete),ops('owner',complete)]);
  check(finished.every(r=>r.status===200) && (await db.prepare('SELECT COUNT(*) n FROM member_email_history WHERE member_id=?').bind('buyer').first()).n === 1, 'Concurrent completion retries produce exactly one history entry');
  check((await ops('buyer',undefined,'?kind=email')).status === 401, 'Changed member session revoked immediately');
  check((await db.prepare('SELECT COUNT(*) n FROM orders WHERE member_id=?').bind('buyer').first()).n === 1, 'Identity change preserves existing purchase association');
  await db.prepare("INSERT INTO item_requests(id,member_id,shop,title,body,status,created_at,updated_at) VALUES('http-request','owner','snacks','Trial snack','Sample trial request','open',?,?)").bind(Date.now(),Date.now()).run();
  const trialBody={action:'initiativeCreate',requestIdSource:'http-request',kind:'trial',category:'Snacks',version:0,endsAt:Date.now()+86400000,note:'Small trial for fixture',requestId:crypto.randomUUID()};
  check((await ops('locked',trialBody)).status===403,'Trial creation requires MFA');
  const trials=await Promise.all([ops('owner',trialBody),ops('owner',{...trialBody,requestId:crypto.randomUUID()})]);
  check(trials.filter(r=>r.status===200).length===1 && trials.filter(r=>r.status===409).length===1,'Concurrent request conversion creates exactly one linked product');
  const linked=await db.prepare('SELECT * FROM product_initiatives WHERE request_id=?').bind('http-request').first();
  await db.prepare('UPDATE products SET active=1,price=100,tax_bp=0,stock=4 WHERE id=?').bind(linked.product_id).run();
  check((await ops('owner',{action:'initiativeOpen',id:linked.id,version:0,requestId:crypto.randomUUID()})).status===200,'Trial opens with atomic opening-stock snapshot');
  check((await db.prepare('SELECT opening_qty FROM product_initiatives WHERE id=?').bind(linked.id).first()).opening_qty===4,'D1 opening quantity uses linked product');
  console.log("Worker gear and operations checks: " + checks);
} finally {
  await mf.dispose();
}
