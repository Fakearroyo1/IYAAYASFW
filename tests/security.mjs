import {
  challengeBindings,
  challengeService,
  grantFixtureMfa,
} from "./security-fixtures.mjs";
// Isolated security regression and bounded load tests. Never targets a public URL.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { scryptSync, randomBytes } from "node:crypto";
const require = createRequire(import.meta.url);
const { Miniflare } = require(
  require.resolve("miniflare", {
    paths: [require.resolve("wrangler/package.json")],
  }),
);
const baseline = process.argv.includes("--baseline");
const results = [],
  findings = [],
  loads = [];
function check(value, name) {
  results.push({ name, passed: !!value });
  assert.ok(value, name);
}
function hardened(value, name) {
  if (baseline) {
    findings.push({ name, protected: !!value });
  } else check(value, name);
}
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
  outboundService: challengeService,
  bindings: { ...challengeBindings, OWNER_EMAIL: "owner@example.test" },
  cf: false,
});
const password = "isolated-security-fixture-2026";
const request = (path, body, cookie = "", extra = {}) =>
  mf.dispatchFetch("https://test.local" + path, {
    method: body === undefined ? "GET" : "POST",
    redirect: "manual",
    headers: {
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json", Origin: "https://test.local" }),
      Cookie: cookie,
      ...extra,
    },
    ...(body === undefined
      ? {}
      : {
          body:
            typeof body === "string"
              ? body
              : JSON.stringify({
                  ...body,
                  challengeToken: body.challengeToken ?? "test-valid",
                }),
        }),
  });
async function batch(name, count, fn) {
  const start = performance.now(),
    durations = [];
  const responses = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const t = performance.now(),
        r = await fn(i);
      await r.arrayBuffer();
      durations.push(performance.now() - t);
      return r;
    }),
  );
  durations.sort((a, b) => a - b);
  loads.push({
    name,
    concurrency: count,
    elapsedMs: Math.round(performance.now() - start),
    p50Ms: Math.round(durations[Math.floor(count * 0.5)]),
    p95Ms: Math.round(durations[Math.min(count - 1, Math.floor(count * 0.95))]),
    statuses: responses.reduce(
      (a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a),
      {},
    ),
  });
  return responses;
}
try {
  const db = await mf.getD1Database("DB");
  for (const file of [
    "drizzle/0000_tiny_shape.sql",
    "drizzle/0001_absent_guardsmen.sql",
    "AUTH-SCHEMA.sql",
    "PRODUCT-SCHEMA.sql",
    "SECURITY-SCHEMA.sql",
    "BETA-SCHEMA.sql",
  ])
    await db.exec(
      readFileSync(file, "utf8")
        .replace(/--> statement-breakpoint/g, "")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  await db.prepare("INSERT INTO settings(id,enabled) VALUES('main',1)").run();
  const salt = randomBytes(16).toString("hex"),
    hash = `scrypt$16384$8$5$${salt}$${scryptSync(password, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 33554432 }).toString("hex")}`;
  const sessions = {};
  for (const [id, role] of [
    ["owner", "admin"],
    ["alice", "member"],
    ["bob", "member"],
    ["gear", "member"],
    ["credit", "member"],
    ["replay", "member"],
    ["spam", "member"],
  ]) {
    await db
      .prepare(
        "INSERT INTO members(id,user_id,email,name,role,credit) VALUES(?,?,?,?,?,?)",
      )
      .bind(id, id, id + "@example.test", id, role, id === "credit" ? 300 : 0)
      .run();
    await db
      .prepare(
        "INSERT INTO auth_credentials(member_id,password_hash,updated_at) VALUES(?,?,?)",
      )
      .bind(id, hash, Date.now())
      .run();
    const r = await request(
      "/api/auth",
      { action: "login", email: id + "@example.test", password },
      {},
      { "cf-connecting-ip": "192.0.2." + (Object.keys(sessions).length + 1) },
    );
    check(r.status === 200, id + " fixture signs in");
    sessions[id] = r.headers.get("set-cookie").split(";")[0];
  }
  await grantFixtureMfa(db, sessions.owner);
  await db
    .prepare(
      "INSERT INTO member_access(member_id,snacks,gear) VALUES('gear',0,1)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO products(id,name,category,price,cost,tax_bp,stock,active) VALUES('drink','Drink','Drinks',100,40,0,100,1),('race','Race','Drinks',100,40,0,3,1),('credit-item','Credit item','Drinks',100,40,0,100,1),('replay-item','Replay item','Drinks',100,40,0,100,1)",
    )
    .run();
  const order = (id = "drink", method = "tab", key = crypto.randomUUID()) => ({
    action: "order",
    id: key,
    method,
    items: [{ id, qty: 1, price: 100 }],
  });
  let r = await request("/api/pilot", undefined, "", {
    "cf-access-jwt-assertion": "forged",
    "oai-authenticated-user-email": "owner@example.test",
  });
  check(r.status === 401, "identity header spoofing denied");
  r = await request("/api/pilot", order(), sessions.alice, {
    Origin: "https://attacker.test",
  });
  check(r.status === 403, "cross-site purchase denied");
  r = await request("/api/pilot", order(), sessions.alice, { Origin: "null" });
  check(r.status === 403, "null origin denied");
  r = await request("/api/pilot", order(), sessions.alice, {
    "Content-Type": "text/plain",
  });
  check(r.status === 415, "simple content type denied");
  r = await request("/api/pilot", order(), sessions.gear);
  check(r.status === 403, "gear-only member cannot purchase snacks");
  for (const value of [-1, 0, 1.5, 9007199254740991, "1", null]) {
    const b = order();
    b.items[0].qty = value;
    r = await request("/api/pilot", b, sessions.alice);
    check(
      r.status === 400,
      "invalid quantity rejected: " + JSON.stringify(value),
    );
  }
  r = await request(
    "/api/pilot",
    {
      action: "member",
      requestId: crypto.randomUUID(),
      email: "alice@example.test",
      role: "admin",
    },
    sessions.alice,
  );
  check(r.status === 403, "mass assignment cannot elevate role");
  r = await request(
    "/api/auth",
    { action: "password", memberId: "owner", password },
    sessions.alice,
  );
  check(r.status === 403, "member cannot replace owner password");
  r = await request("/api/auth", {
    action: "login",
    email: "' OR 1=1 --@example.test",
    password: "incorrect",
  });
  check(r.status === 401, "SQL injection in identity does not authenticate");
  const own = order();
  r = await request("/api/pilot", own, sessions.alice);
  const receipt = await r.json();
  check(r.status === 200, "valid purchase accepted");
  hardened(
    !("original_cost" in receipt.order) && !("cost" in receipt.order),
    "checkout response hides acquisition costs",
  );
  r = await request("/api/pilot", undefined, sessions.alice);
  const state = await r.json();
  hardened(
    state.items.every((i) => !("cost" in i)) &&
      state.orders.every((i) => !("cost" in i)),
    "member history hides acquisition costs",
  );
  check(
    !state.admin && !JSON.stringify(state).includes("scrypt$"),
    "member history excludes admin records and password hashes",
  );
  r = await request("/api/pilot", own, sessions.bob);
  check(r.status === 409, "another member cannot replay an order identifier");
  r = await request("/api/pilot", undefined, sessions.bob);
  check(
    (await r.json()).orders.length === 0,
    "members cannot read another account history",
  );
  const race = await batch("last-stock purchase race", 12, () =>
    request("/api/pilot", order("race"), sessions.bob),
  );
  check(
    race.filter((r) => r.status === 200).length === 3,
    "exactly available units sell under concurrency",
  );
  check(
    (await db.prepare("SELECT stock FROM products WHERE id='race'").first())
      .stock === 0,
    "stock race leaves zero stock",
  );
  const credits = await batch("credit spend race", 12, () =>
    request("/api/pilot", order("credit-item", "credit"), sessions.credit),
  );
  check(
    credits.filter((r) => r.status === 200).length === 3,
    "credit cannot be double spent",
  );
  check(
    (await db.prepare("SELECT credit FROM members WHERE id='credit'").first())
      .credit === 0,
    "credit never becomes negative",
  );
  const repeated = order("replay-item");
  await batch("duplicate checkout race", 20, () =>
    request("/api/pilot", repeated, sessions.replay),
  );
  check(
    (
      await db
        .prepare("SELECT stock FROM products WHERE id='replay-item'")
        .first()
    ).stock === 99,
    "concurrent retries consume stock once",
  );
  const payments = await batch("pending payment spam", 10, () =>
    request(
      "/api/pilot",
      {
        action: "payment",
        id: crypto.randomUUID(),
        purpose: "topup",
        method: "cash",
        amount: 100,
      },
      sessions.spam,
    ),
  );
  const reportResponse = await request(
    "/api/pilot",
    {
      action: "payment",
      id: crypto.randomUUID(),
      purpose: "topup",
      method: "cash",
      amount: 100,
    },
    sessions.bob,
  );
  const reportReceipt = await reportResponse.json();
  check(
    reportResponse.status === 200 && !("fingerprint" in reportReceipt.payment),
    "payment receipt hides its internal fingerprint",
  );
  const pending = await db
    .prepare(
      "SELECT COUNT(*) n FROM payments WHERE member_id='spam' AND purpose='topup' AND status='pending'",
    )
    .first();
  hardened(pending.n <= 5, "pending standalone payment backlog is bounded");
  check(
    (await db.prepare("SELECT credit FROM members WHERE id='spam'").first())
      .credit === 0,
    "spam never creates spendable credit",
  );
  if (!baseline) {
    r = await request(
      "/api/auth",
      { action: "password", memberId: "bob", password: "a".repeat(20) },
      sessions.owner,
    );
    check(
      r.status === 400,
      "direct administrator password assignment is disabled",
    );
    check(
      (await request("/api/pilot", undefined, sessions.bob)).status === 200,
      "rejected password replacement preserves sessions",
    );
    for (const [body, status] of [
      ["{", 400],
      ["[]", 400],
      ["null", 400],
      ['"' + "é".repeat(2500) + '"', 413],
    ]) {
      r = await request("/api/auth", body);
      check(
        r.status === status,
        "JSON parser rejects invalid or oversized input " + status,
      );
    }
    for (const header of ["Next-Action", "X-RSC-Action"])
      check(
        (
          await request(
            "/api/auth",
            { action: "login", email: "bob@example.test", password },
            "",
            { [header]: "untrusted" },
          )
        ).status === 405,
        "Server Action headers rejected on JSON APIs: " + header,
      );
    for (const path of [
      "/_next/image?url=http://127.0.0.1&w=640&q=75",
      "/_vinext/image/",
    ])
      check(
        (await request(path)).status === 404,
        "unused image optimizer blocked: " + path.split("?")[0],
      );
    await db.prepare("DELETE FROM auth_limits").run(); // Isolate the backlog guard from the minute-rate guard.
    await db
      .prepare(
        "INSERT INTO products(id,name,category,price,cost,tax_bp,stock,active) VALUES('gear-backlog','Gear backlog','Gear',100,40,0,100,1)",
      )
      .run();
    await batch("unpaid purchase backlog cap", 25, () =>
      request("/api/pilot", order("gear-backlog", "cash"), sessions.spam),
    );
    check(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM orders WHERE member_id='spam' AND status='pending'",
          )
          .first()
      ).n <= 20,
      "unpaid checkout backlog remains bounded",
    );
    // One setup code cannot create competing passwords or sessions.
    await db
      .prepare(
        "INSERT INTO members(id,email,name) VALUES('new','new@example.test','New')",
      )
      .run();
    const code = "1234567890abcdef12345678";
    const { createHash } = await import("node:crypto");
    await db
      .prepare(
        "INSERT INTO auth_setup(member_id,code_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?)",
      )
      .bind(
        "new",
        createHash("sha256").update(code).digest("hex"),
        Date.now() + 60000,
        "owner",
        Date.now(),
      )
      .run();
    const activations = await batch("one-time activation race", 2, (i) =>
      request("/api/auth", {
        action: "completeSetup",
        email: "new@example.test",
        code,
        password: password + "-" + i,
      }),
    );
    check(
      activations.filter((r) => r.status === 200).length === 1,
      "one setup code activates exactly once under concurrency",
    );
    check(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM auth_credentials WHERE member_id='new'",
          )
          .first()
      ).n === 1,
      "activation race stores one credential",
    );
  }
  // Existing passwords remain usable; age limits apply without mutating business records.
  await db
    .prepare(
      "UPDATE auth_sessions SET created_at=?,expires_at=? WHERE member_id='alice'",
    )
    .bind(Date.now() - 31 * 86400000, Date.now() + 86400000)
    .run();
  hardened(
    (await request("/api/pilot", undefined, sessions.alice)).status === 401,
    "member sessions have an absolute expiration",
  );
  await db
    .prepare(
      "UPDATE auth_sessions SET created_at=?,expires_at=? WHERE member_id='owner'",
    )
    .bind(Date.now() - 13 * 3600000, Date.now() + 86400000)
    .run();
  hardened(
    (await request("/api/pilot", undefined, sessions.owner)).status === 401,
    "admin sessions have a shorter absolute expiration",
  );
  r = await request("/login");
  const html = await r.text(),
    csp = r.headers.get("content-security-policy") || "";
  hardened(
    csp.includes("frame-ancestors 'none'") &&
      r.headers.get("x-frame-options") === "DENY",
    "login prevents hostile framing",
  );
  hardened(
    r.headers.get("x-content-type-options") === "nosniff" &&
      !!r.headers.get("strict-transport-security"),
    "login has transport and MIME protections",
  );
  const second = await request("/login", undefined, "", {
    "Content-Security-Policy": "script-src 'nonce-attacker'",
  });
  hardened(
    second.headers.get("content-security-policy") !== csp &&
      !second.headers
        .get("content-security-policy")
        ?.includes("nonce-attacker"),
    "nonces change per response and cannot be caller-selected",
  );
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  hardened(
    !!nonce &&
      [...html.matchAll(/<script\b([^>]*)>/g)].every((m) =>
        m[1].includes('nonce="' + nonce + '"'),
      ),
    "every rendered login script uses the response nonce",
  );
  r = await request("/login", {}, "", {
    "Next-Action": "not-an-application-action",
  });
  hardened(
    r.status === 405,
    "unused framework server-action POST surface blocked",
  );
  const reads = await batch("authenticated catalog burst", 30, () =>
    request("/api/pilot", undefined, sessions.bob),
  );
  check(
    reads.every((r) => r.status === 200 || r.status === 429),
    "bounded read load produces no 5xx responses",
  );
  const authBurst = await batch("unauthenticated password-work burst", 8, (i) =>
    request(
      "/api/auth",
      {
        action: "login",
        email: "burst" + i + "@example.test",
        password: "invalid",
      },
      "",
      { "cf-connecting-ip": "198.51.100." + i },
    ),
  );
  check(
    authBurst.every((r) => r.status === 401 || r.status === 429),
    "password-work burst fails closed without 5xx",
  );
  // Deliberately large disposable history measures read amplification, not cloud capacity.
  await db
    .prepare(
      "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5000) INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,cost,status,created_at) SELECT 'history-'||x,'history-code-'||x,'synthetic','bob','Bob','cash',100,0,40,'void',? FROM n",
    )
    .bind(Date.now())
    .run();
  r = await request("/api/pilot", undefined, sessions.bob);
  const historyBody = await r.text();
  check(r.status === 200, "5000-row member history remains readable");
  check(
    JSON.parse(historyBody).orders.length === 50 &&
      new TextEncoder().encode(historyBody).length < 30000,
    "large history response is paginated and bounded",
  );
  loads.push({
    name: "5000-row history response",
    bytes: new TextEncoder().encode(historyBody).length,
    rows: 5000,
  });
  await batch("large-history read burst", 5, () =>
    request("/api/pilot", undefined, sessions.bob),
  );
  // Unknown users receive no session and account limits stop repeated password work.
  let last;
  for (let i = 0; i < 11; i++)
    last = await request(
      "/api/auth",
      { action: "login", email: "unknown@example.test", password: "wrong" },
      {},
      { "cf-connecting-ip": "192.0.2.99" },
    );
  check(last.status === 429, "password guessing eventually throttled");
  console.log(
    JSON.stringify(
      {
        mode: baseline ? "baseline" : "hardened",
        passed: results.length,
        findings,
        loads,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(
    JSON.stringify(
      { passed: results.length, results, findings, loads },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await mf.dispose();
}
