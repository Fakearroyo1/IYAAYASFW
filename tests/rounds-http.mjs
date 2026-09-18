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
  console.log("Worker gear and permission checks: " + checks);
} finally {
  await mf.dispose();
}
