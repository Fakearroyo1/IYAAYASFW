import {
  challengeBindings,
  challengeService,
  grantFixtureMfa,
} from "./security-fixtures.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { Miniflare } = require(
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
  outboundService: challengeService,
  bindings: {
    ...challengeBindings,
    OWNER_EMAIL: "owner@example.test",
    BOOTSTRAP_PASSWORD: "test-only-owner-password-123456789",
  },
  cf: false,
});
let assertions = 0;
const check = (value, message) => {
  assert.ok(value, message);
  assertions++;
};
const req = async (path, body, cookie = "", origin = "https://test.local") =>
  mf.dispatchFetch("https://test.local" + path, {
    redirect: "manual",
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body
      ? {
          body: JSON.stringify({
            ...body,
            challengeToken: body.challengeToken ?? "test-valid",
          }),
        }
      : {}),
  });
const cookie = (r) => r.headers.get("set-cookie")?.split(";")[0];
try {
  const db = await mf.getD1Database("DB");
  for (const file of [
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
      readFileSync(file, "utf8")
        .replace(/--> statement-breakpoint/g, "")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  await db
    .prepare(
      "INSERT INTO members(id,email,name,role) VALUES('owner','owner@example.test','Owner','admin'),('test-member','member@example.test','Test member','member')",
    )
    .run();
  await db.prepare("INSERT INTO settings(id) VALUES('main')").run();
  const activate = async (memberId, password, actor = owner) => {
    const target = await db
      .prepare(
        "SELECT m.email,c.password_hash FROM members m LEFT JOIN auth_credentials c ON c.member_id=m.id WHERE m.id=?",
      )
      .bind(memberId)
      .first();
    const codeResult = await req(
      "/api/auth",
      {
        action: target.password_hash ? "issueRecovery" : "issueSetup",
        memberId,
        identityVerified: true,
      },
      actor,
    );
    if (codeResult.status !== 200) return codeResult;
    const code = await codeResult.json();
    return req("/api/auth", {
      action: target.password_hash ? "completeRecovery" : "completeSetup",
      email: target.email,
      code: code.code,
      password,
    });
  };
  let r = await req("/");
  const landing = await r.text();
  check(
    r.status === 200 && !r.headers.has("location") && landing.includes("IYAAYASFW member login") && landing.includes("Why we request Google account information") && !landing.includes("Email the store team"),
    "anonymous root renders public app information without the store",
  );
  r = await req("/login");
  check(
    r.status === 200 && (await r.text()).includes("Member sign-in"),
    "login page renders",
  );
  r = await mf.dispatchFetch("https://test.local/api/pilot", {
    headers: {
      "oai-authenticated-user-email": "owner@example.test",
      "oai-authenticated-user-id": "owner",
      "cf-access-jwt-assertion": "forged",
    },
  });
  check(r.status === 401, "forged identity headers rejected");
  r = await req("/api/pilot");
  check(r.status === 401, "anonymous data denied");
  r = await req("/api/product-images?id=00000000-0000-4000-8000-000000000000");
  check(r.status === 401, "anonymous image denied");
  r = await req(
    "/api/auth",
    {
      action: "login",
      email: "owner@example.test",
      password: "test-only-owner-password-123456789",
    },
    "",
    "https://other.test",
  );
  check(r.status === 403, "cross-origin login denied");
  r = await req("/api/auth", {
    action: "login",
    email: "missing@example.test",
    password: "wrong-password",
  });
  check(
    r.status === 401,
    "unapproved email denied: " + r.status + " " + (await r.clone().text()),
  );
  r = await req("/api/auth", {
    action: "login",
    email: "owner@example.test",
    password: "test-only-owner-password-123456789",
  });
  check(r.status === 200, "owner bootstrap login succeeds");
  const owner = cookie(r);
  await grantFixtureMfa(db, owner);
  check(!!owner, "session issued");
  check(
    /Secure; HttpOnly; SameSite=Lax; Max-Age=2592000/.test(
      r.headers.get("set-cookie"),
    ),
    "secure persistent cookie",
  );
  r = await req("/api/pilot", null, owner);
  check(r.status === 200, "owner data readable");
  check((await r.json()).admin, "owner management available");
  check(!!r.headers.get("set-cookie"), "session renewed during visit");
  r = await activate("test-member", "member-assigned-password-123", owner);
  check(r.status === 200, "admin assigns password");
  const credential = await db
    .prepare(
      "SELECT password_hash FROM auth_credentials WHERE member_id='test-member'",
    )
    .first();
  check(
    !credential.password_hash.includes("member-assigned"),
    "password stored as hash",
  );
  r = await req("/api/auth", {
    action: "login",
    email: "member@example.test",
    password: "wrong-password",
  });
  check(r.status === 401, "wrong password denied");
  r = await req("/api/auth", {
    action: "login",
    email: "member@example.test",
    password: "member-assigned-password-123",
  });
  check(r.status === 200, "member login succeeds");
  const member = cookie(r);
  r = await req("/api/pilot", null, member);
  const state = await r.json();
  check(r.status === 200 && !state.admin, "member cannot read admin data");
  check(!JSON.stringify(state).includes("scrypt$"), "hashes not exposed");
  r = await req(
    "/api/auth",
    {
      action: "password",
      memberId: "owner",
      password: "member-tries-admin-reset",
    },
    member,
  );
  check(r.status === 403, "member cannot reset credentials");
  r = await req("/api/auth", {
    action: "register",
    email: "new@example.test",
    password: "registration-disabled",
  });
  check(r.status === 403, "self registration disabled");

  // Role changes must be enforced by the API and invalidate remembered sessions.
  const updateMember = async (id, changes, actor = owner) => {
    const m = await db
      .prepare("SELECT * FROM members WHERE id=?")
      .bind(id)
      .first();
    return req(
      "/api/pilot",
      {
        action: "member",
        requestId: crypto.randomUUID(),
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        previousRole: m.role,
        debt: m.debt,
        credit: m.credit,
        tabLimit: m.tab_limit,
        previousDebt: m.debt,
        previousCredit: m.credit,
        active: !!m.active,
        ...changes,
      },
      actor,
    );
  };
  check(
    (await (await req("/api/pilot", null, owner)).json()).member.isOwner,
    "owner identity is explicit",
  );
  check(
    (await updateMember("test-member", { role: "admin" }, member)).status ===
      403,
    "member cannot promote themselves",
  );
  check(
    (await updateMember("owner", { role: "member" })).status === 400,
    "owner cannot be demoted",
  );
  check(
    (await updateMember("owner", { active: false })).status === 400,
    "owner cannot be disabled",
  );
  check(
    (await updateMember("test-member", { role: "superadmin" })).status === 400,
    "unsupported role rejected",
  );
  check(
    (await updateMember("test-member", { email: "different@example.test" }))
      .status === 409,
    "existing account cannot silently change identity",
  );
  check(
    (await updateMember("test-member", { role: "admin" })).status === 200,
    "owner grants admin role",
  );
  check(
    (await req("/api/pilot", null, member)).status === 401,
    "promotion invalidates existing device session",
  );
  r = await req("/api/auth", {
    action: "login",
    email: "member@example.test",
    password: "member-assigned-password-123",
  });
  const elevated = cookie(r);
  await grantFixtureMfa(db, elevated);
  let elevatedState = await (await req("/api/pilot", null, elevated)).json();
  check(
    elevatedState.admin &&
      elevatedState.member.role === "admin" &&
      !elevatedState.member.isOwner,
    "promoted admin sees management but is not owner",
  );
  check(
    (await updateMember("owner", { name: "Other owner" }, elevated)).status ===
      403,
    "delegated admin cannot alter owner account",
  );
  check(
    (
      await req(
        "/api/auth",
        {
          action: "password",
          memberId: "owner",
          password: "unauthorized-owner-reset",
        },
        elevated,
      )
    ).status === 403,
    "delegated admin cannot reset owner password",
  );
  check(
    (await req("/api/auth", { action: "revoke", memberId: "owner" }, elevated))
      .status === 403,
    "delegated admin cannot revoke owner devices",
  );
  const newMember = {
    action: "member",
    requestId: crypto.randomUUID(),
    email: "new@example.test",
    name: "New member",
    debt: 0,
    credit: 0,
    tabLimit: 2000,
    active: true,
  };
  check(
    (await req("/api/pilot", { ...newMember, role: "admin" }, elevated))
      .status === 403,
    "delegated admin cannot grant admin rights",
  );
  r = await req("/api/pilot", newMember, elevated);
  const created = await r.json();
  check(
    r.status === 200 && created.created && created.memberId,
    "delegated admin can enroll a regular member",
  );
  check(
    (await activate(created.memberId, "new-member-assigned-password", elevated))
      .status === 200,
    "delegated admin can assign regular member password",
  );
  const shop = (enabled, previousEnabled, actor = owner) =>
    req(
      "/api/pilot",
      {
        action: "shop",
        enabled,
        previousEnabled,
        requestId: crypto.randomUUID(),
      },
      actor,
    );
  check(
    (await shop(true, false, elevated)).status === 400,
    "cannot open shop without a sellable product",
  );
  await db
    .prepare(
      "INSERT INTO products(id,name,category,price,tax_bp,stock,active) VALUES('test-drink','Test drink','Drinks',150,0,2,1)",
    )
    .run();
  check(
    (await shop(true, false, elevated)).status === 200,
    "delegated admin can open configured shop",
  );
  check(
    (await shop(false, false)).status === 409,
    "stale shop status change is rejected",
  );
  const purchase = {
    action: "order",
    id: crypto.randomUUID(),
    method: "tab",
    items: [{ id: "test-drink", price: 150, qty: 1 }],
  };
  r = await req("/api/pilot", purchase, owner);
  check(
    r.status === 200 && (await r.json()).order.status === "tab",
    "configured shop adds snack purchases to tab",
  );
  check(
    (
      await db
        .prepare("SELECT stock FROM products WHERE id='test-drink'")
        .first()
    ).stock === 1,
    "checkout deducts stock once",
  );
  await req("/api/pilot", purchase, owner);
  check(
    (
      await db
        .prepare("SELECT stock FROM products WHERE id='test-drink'")
        .first()
    ).stock === 1,
    "checkout retry does not duplicate stock deduction",
  );
  check(
    (await shop(false, true, elevated)).status === 200,
    "delegated admin can pause shop",
  );
  r = await req("/api/pilot", { ...purchase, id: crypto.randomUUID() }, owner);
  check(
    r.status === 400 && (await r.json()).error.includes("paused"),
    "paused shop rejects purchases",
  );
  const settings = {
    action: "settings",
    requestId: crypto.randomUUID(),
    cashtag: "TestTag",
    cashInstructions: "Cash box",
    reminderDays: 7,
  };
  await req("/api/pilot", settings, owner);
  check(
    (await db.prepare("SELECT enabled FROM settings").first()).enabled === 0,
    "editing payment settings preserves a pause",
  );
  await shop(true, false);
  await req(
    "/api/pilot",
    { ...settings, requestId: crypto.randomUUID() },
    owner,
  );
  check(
    (await db.prepare("SELECT enabled FROM settings").first()).enabled === 1,
    "editing payment settings preserves open checkout",
  );
  check(
    (await updateMember("test-member", { role: "member" })).status === 200,
    "owner can remove delegated admin access",
  );
  check(
    (await req("/api/pilot", null, elevated)).status === 401,
    "demotion invalidates admin device sessions",
  );
  r = await req("/api/auth", {
    action: "login",
    email: "member@example.test",
    password: "member-assigned-password-123",
  });
  const demoted = cookie(r);
  check(
    !(await (await req("/api/pilot", null, demoted)).json()).admin,
    "demoted member cannot read management data",
  );
  check(
    (await shop(false, true, demoted)).status === 403,
    "demoted member cannot pause shop",
  );
  const roleAudits = await db
    .prepare(
      "SELECT detail FROM audit WHERE kind='member_updated' AND target='test-member'",
    )
    .all();
  check(
    roleAudits.results.some((e) => JSON.parse(e.detail).after.role === "admin"),
    "role grants retained in audit history",
  );
  r = await req(
    "/api/auth",
    { action: "revoke", memberId: "test-member" },
    owner,
  );
  check(r.status === 200, "admin revokes sessions");
  check(
    (await req("/api/pilot", null, member)).status === 401,
    "revoked device denied",
  );
  r = await req("/api/auth", {
    action: "login",
    email: "member@example.test",
    password: "member-assigned-password-123",
  });
  const second = cookie(r);
  r = await activate("test-member", "replacement-assigned-password", owner);
  check(r.status === 200, "password replacement succeeds");
  check(
    (await req("/api/pilot", null, second)).status === 401,
    "reset invalidates old devices",
  );
  check(
    (
      await req("/api/auth", {
        action: "login",
        email: "member@example.test",
        password: "member-assigned-password-123",
      })
    ).status === 401,
    "old password denied",
  );
  r = await req("/api/auth", {
    action: "login",
    email: "member@example.test",
    password: "replacement-assigned-password",
  });
  const third = cookie(r);
  r = await req(
    "/api/pilot",
    {
      action: "member",
      requestId: crypto.randomUUID(),
      name: "Test member",
      email: "member@example.test",
      debt: 0,
      credit: 0,
      tabLimit: 2000,
      previousDebt: 0,
      previousCredit: 0,
      active: false,
      reason: "",
    },
    owner,
  );
  check(r.status === 200, "admin disables member");
  check(
    (await req("/api/pilot", null, third)).status === 401,
    "disabled member denied",
  );
  check(
    (
      await db
        .prepare(
          "SELECT count(*) n FROM auth_sessions WHERE member_id='test-member'",
        )
        .first()
    ).n === 0,
    "disable deletes remembered devices",
  );
  const audit = await db.prepare("SELECT detail FROM audit").all();
  check(
    !JSON.stringify(audit).includes("password-123") &&
      !JSON.stringify(audit).includes("scrypt$"),
    "audit contains no passwords or hashes",
  );
  // First Time setup is whitelist-only and requires proof from the administrator.
  await db
    .prepare(
      "INSERT INTO members(id,email,name,role) VALUES('setup-member','setup@example.test','Setup member','member')",
    )
    .run();
  check(
    (
      await req("/api/auth", {
        action: "firstTime",
        email: "outside@example.test",
      })
    ).status === 403,
    "unlisted email cannot reach password setup",
  );
  check(
    (
      await req("/api/auth", {
        action: "firstTime",
        email: "owner@example.test",
      })
    ).status === 403,
    "existing account cannot be claimed through First Time",
  );
  check(
    (
      await req("/api/auth", {
        action: "firstTime",
        email: "setup@example.test",
      })
    ).status === 403,
    "whitelisted email alone cannot enumerate eligibility",
  );
  check(
    (
      await req("/api/auth", {
        action: "completeSetup",
        email: "setup@example.test",
        code: "guess",
        password: "first-time-member-password",
      })
    ).status === 403,
    "email alone cannot claim a whitelisted account",
  );
  r = await req(
    "/api/auth",
    { action: "issueSetup", memberId: "setup-member" },
    owner,
  );
  const setup = await r.json();
  check(
    r.status === 200 && setup.code && setup.expiresAt > Date.now(),
    "admin issues expiring setup code",
  );
  check(
    (
      await req("/api/auth", {
        action: "firstTime",
        email: "setup@example.test",
        code: setup.code,
      })
    ).status === 200,
    "email and setup code permit password step",
  );
  const codeRecord = await db
    .prepare("SELECT code_hash FROM auth_setup WHERE member_id='setup-member'")
    .first();
  check(
    codeRecord.code_hash !== setup.code &&
      !codeRecord.code_hash.includes(setup.code),
    "setup code stored only as hash",
  );
  r = await req("/api/auth", {
    action: "completeSetup",
    email: "setup@example.test",
    code: setup.code,
    password: "first-time-member-password",
  });
  const setupSession = cookie(r);
  check(
    r.status === 200 && setupSession,
    "member creates password and receives secure session",
  );
  check(
    !(await db
      .prepare("SELECT * FROM auth_setup WHERE member_id='setup-member'")
      .first()),
    "setup code consumed after activation",
  );
  check(
    (
      await req("/api/auth", {
        action: "completeSetup",
        email: "setup@example.test",
        code: setup.code,
        password: "attacker-replacement-password",
      })
    ).status === 403,
    "used code cannot reset existing credentials",
  );
  check(
    (
      await req(
        "/api/auth",
        { action: "issueSetup", memberId: "setup-member" },
        owner,
      )
    ).status === 400,
    "admin cannot issue setup code over an existing password",
  );
  r = await req("/api/auth", {
    action: "login",
    email: "setup@example.test",
    password: "first-time-member-password",
  });
  const otherDevice = cookie(r);
  check(r.status === 200, "existing new password signs in on another device");
  check(
    (
      await req(
        "/api/auth",
        {
          action: "changePassword",
          currentPassword: "incorrect",
          password: "member-chosen-new-password",
        },
        setupSession,
      )
    ).status === 403,
    "password change requires correct current password",
  );
  check(
    (
      await req(
        "/api/auth",
        {
          action: "changePassword",
          currentPassword: "first-time-member-password",
          password: "member-chosen-new-password",
        },
        setupSession,
        "https://other.test",
      )
    ).status === 403,
    "cross-origin password change denied",
  );
  r = await req(
    "/api/auth",
    {
      action: "changePassword",
      currentPassword: "first-time-member-password",
      password: "member-chosen-new-password",
    },
    setupSession,
  );
  check(r.status === 200, "signed-in member changes own password");
  check(
    (await req("/api/pilot", null, setupSession)).status === 200,
    "password change preserves current device session",
  );
  check(
    (await req("/api/pilot", null, otherDevice)).status === 401,
    "password change revokes other devices",
  );
  check(
    (
      await req("/api/auth", {
        action: "login",
        email: "setup@example.test",
        password: "first-time-member-password",
      })
    ).status === 401,
    "old password no longer works",
  );
  check(
    (
      await req("/api/auth", {
        action: "login",
        email: "setup@example.test",
        password: "member-chosen-new-password",
      })
    ).status === 200,
    "new password works",
  );
  await db.prepare("DELETE FROM auth_limits").run();
  const unknownReset = await (
    await req("/api/auth", {
      action: "requestReset",
      email: "outside-reset@example.test",
    })
  ).json();
  const knownReset = await (
    await req("/api/auth", {
      action: "requestReset",
      email: "setup@example.test",
    })
  ).json();
  check(
    unknownReset.message === knownReset.message,
    "reset response does not expose membership",
  );
  await req("/api/auth", {
    action: "requestReset",
    email: "setup@example.test",
  });
  check(
    (
      await db
        .prepare(
          "SELECT count(*) n FROM password_reset_requests WHERE member_id='setup-member' AND status='pending'",
        )
        .first()
    ).n === 1,
    "repeated requests create one admin notification",
  );
  let updated = await (await req("/api/pilot", null, owner)).json();
  check(
    updated.admin.resets.some((r) => r.member_id === "setup-member"),
    "reset request visible to administrators",
  );
  const ownData = await (await req("/api/pilot", null, setupSession)).json();
  check(
    !ownData.admin && !JSON.stringify(ownData).includes("code_hash"),
    "members cannot read recovery queue or credentials",
  );
  check(
    (
      await req(
        "/api/auth",
        { action: "resolveReset", memberId: "setup-member" },
        setupSession,
      )
    ).status === 403,
    "members cannot clear admin recovery requests",
  );
  r = await activate("setup-member", "administrator-reset-password", owner);
  check(r.status === 200, "admin can replace a forgotten password");
  check(
    (
      await db
        .prepare(
          "SELECT status FROM password_reset_requests WHERE member_id='setup-member'",
        )
        .first()
    ).status === "resolved",
    "password reset resolves its notification",
  );
  check(
    (await req("/api/pilot", null, setupSession)).status === 401,
    "admin reset signs out remembered devices",
  );
  const currentSetup = await db
    .prepare("SELECT * FROM members WHERE id='setup-member'")
    .first();
  await req(
    "/api/pilot",
    {
      action: "member",
      requestId: crypto.randomUUID(),
      id: currentSetup.id,
      name: currentSetup.name,
      email: currentSetup.email,
      role: "member",
      debt: 0,
      credit: 0,
      tabLimit: 2000,
      previousDebt: 0,
      previousCredit: 0,
      active: true,
      snacks: false,
      gear: true,
    },
    owner,
  );
  r = await req("/api/auth", {
    action: "login",
    email: "setup@example.test",
    password: "administrator-reset-password",
  });
  const gearOnly = cookie(r);
  updated = await (await req("/api/pilot", null, gearOnly)).json();
  check(
    updated.member.snacks === 0 &&
      updated.products.every((p) => p.category === "Gear"),
    "gear-only restriction survives sign-in in Workers runtime",
  );
  check(
    (
      await req(
        "/api/pilot",
        { ...purchase, id: crypto.randomUUID() },
        gearOnly,
      )
    ).status === 403,
    "gear-only account cannot forge snack purchase",
  );
  const imageId = "a0000000-0000-4000-8000-000000000001",
    path = "/api/product-images?id=" + imageId;
  await db
    .prepare("UPDATE products SET image=? WHERE id='test-drink'")
    .bind(path)
    .run();
  const bucket = await mf.getR2Bucket("BUCKET");
  await bucket.put("products/" + imageId, "test-image", {
    httpMetadata: { contentType: "image/png" },
  });
  check(
    (await req(path, null, gearOnly)).status === 404,
    "gear-only account cannot retrieve snack image through API",
  );
  check(
    (await req(path, null, owner)).status === 200,
    "admin can retrieve assigned image",
  );
  check(
    (await req("/products/test-drink")).status === 307,
    "product detail page requires member login",
  );
  const auditAfter = await db.prepare("SELECT detail FROM audit").all();
  check(
    !JSON.stringify(auditAfter).includes(setup.code) &&
      !JSON.stringify(auditAfter).includes("member-chosen-new-password"),
    "activation and reset audit does not contain passwords or setup codes",
  );
  r = await req("/api/auth", { action: "logout" }, owner);
  check(
    r.status === 200 && /Max-Age=0/.test(r.headers.get("set-cookie")),
    "logout clears cookie",
  );
  check(
    (await req("/api/pilot", null, owner)).status === 401,
    "logged-out session denied",
  );
  for (let n = 0; n < 11; n++)
    r = await req("/api/auth", {
      action: "login",
      email: "rate@example.test",
      password: "bad-password",
    });
  check(r.status === 429, "repeated attempts rate limited");
  console.log(
    `${assertions} authentication integration checks passed in Workers runtime.`,
  );
} finally {
  await mf.dispose();
}
