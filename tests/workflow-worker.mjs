// The real compiled Worker with disposable D1/R2 and signed synthetic Access.
// No production data, credentials, provider traffic, or testing bypass in the app.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
const require = createRequire(import.meta.url),
  { Miniflare } = require(
    require.resolve("miniflare", {
      paths: [require.resolve("wrangler/package.json")],
    }),
  );
export async function workflowWorker() {
  const { privateKey, publicKey } = await generateKeyPair("RS256"),
    jwk = {
      ...(await exportJWK(publicKey)),
      kid: "workflow-fixture",
      alg: "RS256",
      use: "sig",
    },
    issuer = "https://workflow-fixture.cloudflareaccess.com",
    audience = "workflow-fixture";
  const settings = {
    IDENTITY_ENABLED: "true",
    IDENTITY_ROLLOUT: "member-beta",
    IDENTITY_BASE_DOMAIN: "test.local",
    IDENTITY_OWNER_MEMBER_ID: "owner",
    IDENTITY_PASSKEY_ENABLED: "true",
    IDENTITY_GOOGLE_ENABLED: "true",
    IDENTITY_GOOGLE_BOOTSTRAP_ENABLED: "true",
    IDENTITY_MICROSOFT_ENABLED: "true",
    ADMIN_ACCESS_TEAM_DOMAIN: issuer,
    IDENTITY_ADMIN_ACCESS_AUD: audience,
    GOOGLE_CLIENT_ID: "synthetic-google",
    MICROSOFT_CLIENT_ID: "synthetic-microsoft",
    TURNSTILE_SITE_KEY: "fixture",
    TURNSTILE_SECRET_KEY: "fixture",
    OWNER_EMAIL: "owner@example.test",
  };
  let outbound = 0,
    dropAction = null;
  const mf = new Miniflare({
    cf: false,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    modulesRoot: resolve("dist/server"),
    modules: [
      { type: "ESModule", path: resolve("dist/server/index.js") },
      ...readdirSync("dist/server", { recursive: true })
        .filter((p) => p.endsWith(".js") && p !== "index.js")
        .map((p) => ({ type: "ESModule", path: resolve("dist/server", p) })),
    ],
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
    bindings: settings,
    outboundService: async (request) => {
      if (request.url === issuer + "/cdn-cgi/access/certs")
        return Response.json({ keys: [jwk] });
      outbound++;
      return new Response("Unexpected outbound from isolated test", {
        status: 502,
      });
    },
  });
  const db = await mf.getD1Database("DB"),
    run = (sql, ...args) =>
      db
        .prepare(sql)
        .bind(...args)
        .run(),
    one = (sql, ...args) =>
      db
        .prepare(sql)
        .bind(...args)
        .first();
  for (const file of [
    ...readdirSync("drizzle")
      .filter((x) => x.endsWith(".sql"))
      .sort()
      .map((x) => "drizzle/" + x),
    ...[
      "AUTH",
      "PRODUCT",
      "SECURITY",
      "BETA",
      "ROUNDS",
      "GUEST",
      "AUTOPILOT",
      "REWARDS",
      "EARNING",
      "REDEMPTION",
      "PROFILE-EXPERIENCE",
      "ADMIN-EXPERIENCE",
      "WORKFLOW",
      "IDENTITY",
    ].map((x) => x + "-SCHEMA.sql"),
  ])
    await db.exec(
      readFileSync(file, "utf8")
        .replace(/--> statement-breakpoint/g, "")
        .replace(/^\s*--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  await run(
    "INSERT INTO settings(id,enabled,cashtag) VALUES('main',1,'SyntheticOnly')",
  );
  await run(
    "INSERT INTO members(id,email,name,role,debt,credit) VALUES('owner','owner@example.test','Synthetic owner','admin',0,0),('member','member@example.test','Synthetic member','member',725,250),('other','other@example.test','Other member','member',0,0)",
  );
  const password = "Only synthetic fixture 13579",
    salt = "12345678901234567890123456789012",
    hash =
      "scrypt$16384$8$5$" +
      salt +
      "$" +
      scryptSync(password, salt, 32, {
        N: 16384,
        r: 8,
        p: 5,
        maxmem: 32 * 1024 * 1024,
      }).toString("hex");
  for (const id of ["owner", "member", "other"])
    await run(
      "INSERT INTO auth_credentials VALUES(?,?,?)",
      id,
      hash,
      Date.now(),
    );
  await run(
    "INSERT INTO products(id,name,category,price,tax_bp,stock,cost,active) VALUES('drink','Synthetic drink','Drinks',250,0,20,100,1),('snack','Synthetic snack','Snacks',100,0,0,NULL,1),('gear','Synthetic shirt','Gear',1500,0,5,600,1)",
  );
  await run(
    "INSERT INTO identity_admin_principals(id,issuer,subject,member_id,identity_owner,provisioned_at,evidence) VALUES('owner-principal',?,'workflow-owner','owner',1,?,'signed synthetic test fixture')",
    issuer,
    Date.now(),
  );
  const access = await new SignJWT({ email: "irrelevant@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("workflow-owner")
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(privateKey);
  const admin = {
      host: "admin.test.local",
      cookies: new Map(),
      csrf: "",
      access,
    },
    member = { host: "test.local", cookies: new Map(), csrf: "", access: "" };
  const raw = randomBytes(32).toString("hex");
  await run(
    "INSERT INTO auth_sessions VALUES(?,?,?,?)",
    createHash("sha256").update(raw).digest("hex"),
    "member",
    Date.now(),
    Date.now() + 3600000,
  );
  member.cookies.set("__Host-supply-session", raw);
  const headers = (b) => ({
    Cookie: [...b.cookies].map(([k, v]) => k + "=" + v).join("; "),
    ...(b.access ? { "cf-access-jwt-assertion": b.access } : {}),
  });
  const save = (b, r) => {
    for (const c of r.headers.getSetCookie()) {
      const [k, ...v] = c.split(";")[0].split("=");
      b.cookies.set(k, v.join("="));
    }
  };
  const request = async (b, path, body, extra = {}) => {
    const r = await mf.dispatchFetch("https://" + b.host + path, {
      redirect: "manual",
      method: body ? "POST" : "GET",
      headers: {
        ...headers(b),
        ...(body
          ? {
              Origin: "https://" + b.host,
              "Content-Type": "application/json",
              "x-identity-csrf": b.csrf,
            }
          : {}),
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    save(b, r);
    return r;
  };
  const context = async (b) => {
    const r = await request(b, "/identity/api"),
      j = await r.json();
    if (!r.ok) throw Error(JSON.stringify(j));
    b.csrf = j.csrf;
    return j;
  };
  await context(admin);
  const login = await request(admin, "/identity/api", { action: "adminLogin" });
  if (!login.ok) throw Error(await login.text());
  await context(admin);
  await context(member);
  const browserRoute = async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (
      ![
        "test.local",
        "admin.test.local",
        "auth.test.local",
        "register.test.local",
      ].includes(url.hostname)
    ) {
      await route.abort();
      return;
    }
    const root = resolve("dist/client"),
      asset = resolve(root, "." + decodeURIComponent(url.pathname));
    if (asset.startsWith(root + "\\") || asset.startsWith(root + "/"))
      if (existsSync(asset) && extname(asset)) {
        const type =
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".webp": "image/webp",
            ".ico": "image/x-icon",
            ".woff2": "font/woff2",
          }[extname(asset)] || "application/octet-stream";
        await route.fulfill({
          status: 200,
          contentType: type,
          body: readFileSync(asset),
        });
        return;
      }
    const incoming = await req.allHeaders();
    if (url.hostname === "admin.test.local")
      incoming["cf-access-jwt-assertion"] = access;
    const result = await mf.dispatchFetch(req.url(), {
      method: req.method(),
      headers: incoming,
      redirect: "manual",
      ...(req.postDataBuffer() ? { body: req.postDataBuffer() } : {}),
    });
    if (
      dropAction &&
      req.method() === "POST" &&
      req.postDataJSON()?.action === dropAction
    ) {
      dropAction = null;
      await result.arrayBuffer();
      await route.abort("failed");
      return;
    }
    const responseHeaders = Object.fromEntries(result.headers);
    delete responseHeaders["content-encoding"];
    delete responseHeaders["transfer-encoding"];
    responseHeaders["set-cookie"] = result.headers.getSetCookie().join("\n");
    await route.fulfill({
      status: result.status,
      headers: responseHeaders,
      body: Buffer.from(await result.arrayBuffer()),
    });
  };
  return {
    mf,
    db,
    run,
    one,
    admin,
    member,
    request,
    context,
    headers,
    password,
    browserRoute,
    dropNextResponse: (action) => {
      dropAction = action;
    },
    outbound: () => outbound,
    close: () => mf.dispose(),
  };
}
