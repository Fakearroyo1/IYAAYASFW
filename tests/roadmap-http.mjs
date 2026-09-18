import assert from "node:assert/strict";
import { testPng } from "./png-fixture.mjs";
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
const common = {
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: { DB: "roadmap-test-db" },
  r2Buckets: { BUCKET: "roadmap-test-bucket" },
  outboundService: challengeService,
};
const mf = new Miniflare({
  cf: false,
  workers: [
    {
      ...common,
      name: "main",
      modules: [
        { type: "ESModule", path: resolve("dist/server/index.js") },
        ...readdirSync("dist/server", { recursive: true })
          .filter((p) => p.endsWith(".js") && p !== "index.js")
          .map((p) => ({ type: "ESModule", path: resolve("dist/server", p) })),
      ],
      modulesRoot: resolve("dist/server"),
      bindings: { ...challengeBindings, OWNER_EMAIL: "owner@example.test" },
    },
    {
      ...common,
      name: "gear",
      routes: ["gear.local/*"],
      scriptPath: resolve("gear/.sites-runtime/gear-worker/worker.js"),
      modules: true,
      bindings: { GEAR_SESSION_SECRET: "test-only-gear-key-".repeat(4) },
      serviceBindings: { ASSETS: async () => new Response("Test gear assets") },
    },
  ],
});
let checks = 0;
const ok = (x, label) => {
  assert.ok(x, label);
  checks++;
};
try {
  const db = await mf.getD1Database("DB", "main"),
    gear = await mf.getWorker("gear");
  for (const f of [
    "drizzle/0000_tiny_shape.sql",
    "drizzle/0001_absent_guardsmen.sql",
    "AUTH-SCHEMA.sql",
    "PRODUCT-SCHEMA.sql",
    "SECURITY-SCHEMA.sql",
    "BETA-SCHEMA.sql",
    "ROUNDS-SCHEMA.sql",
    "GUEST-SCHEMA.sql",
    "AUTOPILOT-SCHEMA.sql",
    "REWARDS-SCHEMA.sql",
    "EARNING-SCHEMA.sql",
    "REDEMPTION-SCHEMA.sql",
    "PROFILE-EXPERIENCE-SCHEMA.sql",
    "ADMIN-EXPERIENCE-SCHEMA.sql",
  ])
    await db.exec(
      readFileSync(f, "utf8")
        .replace(/--> statement-breakpoint/g, "")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  const run = (sql, ...v) =>
      db
        .prepare(sql)
        .bind(...v)
        .run(),
    one = (sql, ...v) =>
      db
        .prepare(sql)
        .bind(...v)
        .first();
  await run(
    "INSERT INTO settings(id,enabled,cashtag) VALUES('main',1,'$UnitTest')",
  );
  const cookies = {};
  for (const [id, role] of [
    ["owner", "admin"],
    ["locked", "admin"],
    ["member", "member"],
  ]) {
    await run(
      "INSERT INTO members(id,user_id,email,name,role) VALUES(?,?,?,?,?)",
      id,
      id,
      id + "@example.test",
      id,
      role,
    );
    await run(
      "INSERT INTO auth_credentials(member_id,password_hash,updated_at) VALUES(?,?,?)",
      id,
      "test-unusable",
      Date.now(),
    );
    const token = randomBytes(32).toString("hex");
    await run(
      "INSERT INTO auth_sessions(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)",
      createHash("sha256").update(token).digest("hex"),
      id,
      Date.now(),
      Date.now() + 3600000,
    );
    cookies[id] = "__Host-supply-session=" + token;
  }
  await grantFixtureMfa(db, cookies.owner);
  const request = (who, path, body, origin = "https://test.local") =>
    mf.dispatchFetch("https://test.local" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookies[who] || "",
        Origin: origin,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const post = (who, body, origin) =>
    request(
      who,
      "/api/roadmap",
      { requestId: crypto.randomUUID(), ...body },
      origin,
    );
  for (const kind of [
    "guest",
    "inventory",
    "month&month=2026-08",
    "rewards&admin=true",
  ])
    for (const who of ["", "member", "locked"])
      ok(
        (await request(who, "/api/roadmap?kind=" + kind)).status ===
          (who ? 403 : 401),
        kind + " denies " + who,
      );
  for (const kind of [
    "guest",
    "inventory",
    "month&month=2026-08",
    "rewards&admin=true",
  ]) {
    const r = await request("owner", "/api/roadmap?kind=" + kind);
    ok(
      r.status === 200,
      kind + " works under real workerd: " + (await r.text()),
    );
  }
  ok(
    (await request("owner", "/api/operations?kind=inbox")).status === 200,
    "expanded inbox respects Worker compound-select limit",
  );
  ok(
    (
      await post(
        "owner",
        {
          action: "guestSettings",
          version: 0,
          enabled: true,
          reason: "Test scope",
        },
        "https://evil.example",
      )
    ).status === 403,
    "CSRF protection",
  );
  ok(
    (
      await post("member", {
        action: "rewardAward",
        memberId: "member",
        amount: 1000,
        reason: "Client cannot award",
      })
    ).status === 403,
    "member cannot award",
  );
  ok(
    (await request("member", "/api/roadmap?kind=rewards")).status === 200,
    "member recognition page read",
  );
  ok(
    (
      await post("owner", {
        action: "rewardAward",
        memberId: "member",
        amount: 200,
        reason: "Test image tier unlock",
      })
    ).status === 200,
    "admin recognition",
  );
  ok(
    (
      await post("owner", {
        action: "guestSettings",
        version: 0,
        enabled: true,
        reason: "Open disposable test campaign",
      })
    ).status === 200,
    "admin enables guest",
  );
  await run(
    "INSERT INTO products(id,name,category,price,cost,tax_bp,stock,active) VALUES('gear','Unit Shirt','Gear',2000,1000,0,5,1),('snack','Bar','Snacks',100,50,0,5,1)",
  );
  const camp = await (
    await post("owner", {
      action: "guestCampaign",
      name: "HTTP campaign",
      startsAt: Date.now() - 1000,
      endsAt: Date.now() + 86400000,
      active: true,
      items: [{ productId: "gear", limit: 100 }],
    })
  ).json();
  ok(!!camp.id, "campaign created");
  const code = await (
    await post("owner", {
      action: "guestCode",
      id: camp.id,
      version: 0,
      reason: "Issue test code",
    })
  ).json();
  const g = (
    path,
    body,
    cookie = "",
    ip = "192.0.2.1",
    origin = "https://gear.local",
  ) =>
    mf.dispatchFetch("https://gear.local" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
        "CF-Connecting-IP": ip,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const anonymous = await g("/api/catalog");
  ok(
    anonymous.status === 401,
    "anonymous catalog denied: " +
      anonymous.status +
      " " +
      (await anonymous.text()),
  );
  for (const path of [
    "/api/pilot",
    "/api/auth",
    "/api/roadmap",
    "/api/export",
    "/api/admin/access",
    "/login",
    "/products/snack",
  ])
    ok((await g(path)).status === 404, "guest router excludes " + path);
  ok(
    (
      await g(
        "/api/entry",
        { code: code.code },
        "",
        "192.0.2.1",
        "https://evil.example",
      )
    ).status === 403,
    "guest CSRF rejected",
  );
  const enter = await g("/api/entry", { code: code.code }),
    setCookie = enter.headers.get("set-cookie"),
    cookie = setCookie.split(";")[0];
  ok(
    enter.status === 200 &&
      setCookie.includes("Secure") &&
      setCookie.includes("HttpOnly") &&
      setCookie.includes("SameSite=Strict") &&
      !setCookie.includes("Domain="),
    "host-only secure campaign cookie",
  );
  const cat = await (await g("/api/catalog", null, cookie)).json();
  ok(
    cat.items.length === 1 && !JSON.stringify(cat.items).includes("snack"),
    "only campaign gear visible: " + JSON.stringify(cat),
  );
  ok(
    (
      await g(
        "/api/quote",
        { items: [{ productId: "snack", qty: 1 }], delivery: "pickup" },
        cookie,
      )
    ).status === 409,
    "snack purchase denied",
  );
  ok(
    (
      await g(
        "/api/quote",
        {
          items: [{ productId: "gear", qty: 1, price: 1 }],
          delivery: "pickup",
        },
        cookie,
      )
    ).status === 200,
    "quote uses server price",
  );
  const body = {
    requestId: crypto.randomUUID(),
    receiptSecret: "B".repeat(48),
    name: "Guest",
    email: "guest@example.test",
    method: "cash",
    paymentReported: true,
    delivery: "pickup",
    expectedTotal: 2000,
    items: [{ productId: "gear", qty: 1 }],
  };
  const placed = await g("/api/orders", body, cookie),
    order = await placed.json();
  ok(placed.status === 200, "guest order in workerd: " + JSON.stringify(order));
  ok((await g("/api/orders", body, cookie)).status === 200, "HTTP retry safe");
  ok(
    (await g("/api/receipt?id=" + order.orderId)).status === 403,
    "own receipt auth required",
  );
  ok(
    (await g("/api/receipt?id=" + order.orderId, null, cookies.member))
      .status === 403,
    "member cookie not guest authority",
  );
  const r = await g("/api/receipt?id=" + order.orderId, null, cookie),
    receipt = await r.json();
  ok(
    r.status === 200 && !JSON.stringify(receipt).includes("guest@example.test"),
    "receipt minimal data",
  );
  const resumed = await g("/api/resume", {
      code: order.order.code,
      secret: body.receiptSecret,
    }),
    receiptCookie = resumed.headers.get("set-cookie").split(";")[0];
  ok(
    resumed.status === 200 &&
      (await g("/api/catalog", null, receiptCookie)).status === 401,
    "receipt recovery never opens catalog",
  );
  ok(
    (await g("/api/receipt?id=" + order.orderId, null, receiptCookie))
      .status === 200,
    "recovered receipt works",
  );
  await post("owner", {
    action: "guestCode",
    id: camp.id,
    version: 1,
    revoke: true,
    reason: "End campaign access",
  });
  ok(
    (await g("/api/catalog", null, cookie)).status === 401,
    "code revocation invalidates sessions",
  );
  ok(
    (await g("/api/receipt?id=" + order.orderId, null, receiptCookie))
      .status === 200,
    "own paid/pending receipt persists after campaign closes",
  );
  let limited = false;
  for (let i = 0; i < 9; i++) {
    const response = await g("/api/entry", { code: "WRONG" }, "", "192.0.2.9");
    if (response.status === 429) limited = true;
  }
  ok(limited, "code guesses rate limited");
  // Browser PNG codec is exercised in Node tests; the route must reject arbitrary formats.
  const upload = await mf.dispatchFetch(
    "https://test.local/api/profile-images?kind=avatar",
    {
      method: "POST",
      headers: {
        Cookie: cookies.member,
        Origin: "https://test.local",
        "Content-Type": "image/svg+xml",
      },
      body: "<svg/>",
    },
  );
  ok(upload.status === 415, "SVG profile upload denied");
  const png = await mf.dispatchFetch(
    "https://test.local/api/profile-images?kind=avatar",
    {
      method: "POST",
      headers: {
        Cookie: cookies.member,
        Origin: "https://test.local",
        "Content-Type": "image/png",
      },
      body: testPng(),
    },
  );
  const pngData = await png.json();
  ok(
    png.status === 200,
    "valid PNG processed in workerd: " + JSON.stringify(pngData),
  );
  const privateImage = await request(
    "member",
    "/api/profile-images?id=" + pngData.id,
  );
  ok(
    privateImage.status === 200 &&
      !Buffer.from(await privateImage.arrayBuffer()).includes(
        "private-test-metadata",
      ),
    "PNG metadata stripped in real Worker",
  );
  ok(
    (await request("locked", "/api/profile-images?id=" + pngData.id)).status ===
      404,
    "unapproved image hidden from other sessions",
  );
  ok(
    (
      await post("member", {
        action: "profileSave",
        version: (await one("SELECT version FROM member_profiles WHERE member_id='member'")).version,
        alias: "Crew",
        bio: "",
        accent: "blue",
        theme: "classic",
        visible: true,
        boardOptIn: false,
        badges: [],
        avatarId: pngData.id,
      })
    ).status === 200,
    "member attaches owned unlocked avatar",
  );
  ok(
    (await request("locked", "/api/profile-images?id=" + pngData.id)).status ===
      404,
    "pending profile image stays private",
  );
  await post("owner", {
    action: "profileModerate",
    memberId: "member",
    version: (await one("SELECT version FROM member_profiles WHERE member_id='member'")).version,
    state: "approved",
    reason: "Avatar approved in isolated test",
  });
  ok(
    (await request("locked", "/api/profile-images?id=" + pngData.id)).status ===
      200,
    "approved opted-in image visible to signed-in member",
  );
  ok((await post("member", {
    action: "profileSave",
    version: (await one("SELECT version FROM member_profiles WHERE member_id='member'")).version,
    alias: "Pending identity edit", bio: "", accent: "blue", theme: "classic",
    visible: true, boardOptIn: false, badges: [], avatarId: pngData.id,
  })).status === 200, "member can submit another profile edit");
  ok((await request("locked", "/api/profile-images?id=" + pngData.id)).status === 200,
    "last approved image remains available while a new profile edit awaits review");
  const publicId = (await one("SELECT public_id FROM member_profiles WHERE member_id='member'")).public_id;
  const reviewedProfile = await request("locked", "/api/roadmap?kind=profile&id=" + publicId);
  const reviewedProfileData = await reviewedProfile.json();
  ok(reviewedProfile.status === 200 && reviewedProfileData.profile.alias === "Crew" && reviewedProfileData.profile.memberName === "member",
    "authenticated public profile retains reviewed alias and actual member name during pending edit");
  ok((await request("", "/api/roadmap?kind=profile&id=" + publicId)).status === 401,
    "profile identity is not exposed without a member session");
  await post("owner", {
    action: "profileModerate",
    memberId: "member",
    version: (await one("SELECT version FROM member_profiles WHERE member_id='member'")).version,
    state: "hidden",
    reason: "Testing immediate moderation hide",
  });
  ok(
    (await request("locked", "/api/profile-images?id=" + pngData.id)).status ===
      404,
    "hiding profile revokes image visibility",
  );
  ok(
    (await request("", "/api/profile-images?id=" + crypto.randomUUID()))
      .status === 401,
    "profile images require sign-in",
  );
  ok(
    (await (await g("/api/status")).json()).open === true,
    "public status exposes availability only",
  );
  await post("owner", {
    action: "guestSettings",
    version: 1,
    enabled: false,
    reason: "Close isolated storefront",
  });
  ok(
    (await (await g("/api/status")).json()).open === false,
    "closed guest state reported",
  );
  console.log("Roadmap HTTP:", checks, "compiled Worker checks passed.");
} finally {
  await mf.dispose();
}
