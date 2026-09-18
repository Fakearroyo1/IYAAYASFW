import {
  type Row,
  first,
  rows,
  str,
  uid,
  stmt,
  batchAtomic,
  guard,
  codeHash,
  receiptHash,
  cookie,
  readCookie,
  signedToken,
  verifiedToken,
  sessionFor,
  campaignCatalog,
  publicCatalog,
  GUEST_COOKIE,
  RECEIPT_COOKIE,
  SESSION_SECONDS,
  secretKey,
} from "./common";
import {
  guestQuote,
  submitGuestOrder,
  guestReceipt,
  expireGuestOrders,
} from "./orders";
import { PilotError } from "../pilot/core";
import { rateLimit } from "../auth/session";
import { readJson, RequestError } from "../security/http";
export interface GearEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  GEAR_SESSION_SECRET?: string;
}
const json = (value: unknown, status = 200) => Response.json(value, { status });
const noStore = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
};
async function handle(request: Request, env: GearEnv): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  if (
    request.method === "GET" &&
    ["/", "/gear.js", "/gear.css", "/favicon.svg", "/brand-mark.png"].includes(
      path,
    )
  )
    return env.ASSETS.fetch(
      new Request(new URL(path === "/" ? "/index.html" : path, url), request),
    );
  if (!["GET", "POST"].includes(request.method))
    return new Response(null, { status: 405 });
  if (
    ![
      "/api/status",
      "/api/entry",
      "/api/catalog",
      "/api/quote",
      "/api/orders",
      "/api/receipt",
      "/api/resume",
      "/api/signout",
      "/media",
    ].includes(path)
  )
    return new Response(null, { status: 404 });
  if (!env.DB) throw new RequestError("Gear ordering is unavailable.", 503);
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (!(await rateLimit(env.DB, "gear-ip:" + ip, 120, 60000)))
    throw new RequestError("Try again in one minute.", 429);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin)
    throw new RequestError("Open the gear store and try again.", 403);
  if (path === "/api/status" && request.method === "GET")
    return json({
      open:
        !!env.GEAR_SESSION_SECRET &&
        env.GEAR_SESSION_SECRET.length >= 32 &&
        !!(
          await first(
            env.DB,
            "SELECT enabled FROM guest_settings WHERE id='main'",
          )
        )?.enabled,
    });
  if (path === "/api/signout" && request.method === "POST") {
    const t = await verifiedToken(
      env.GEAR_SESSION_SECRET || "",
      readCookie(request, GUEST_COOKIE),
      "campaign",
    );
    if (t)
      await env.DB.prepare("DELETE FROM guest_sessions WHERE id=?")
        .bind(t.sid)
        .run();
    const r = json({ ok: true });
    r.headers.append("Set-Cookie", cookie(GUEST_COOKIE, "", 0));
    r.headers.append("Set-Cookie", cookie(RECEIPT_COOKIE, "", 0));
    return r;
  }
  secretKey(env.GEAR_SESSION_SECRET);
  if (path === "/api/entry" && request.method === "POST") {
    if (!(await rateLimit(env.DB, "gear-entry:" + ip, 8, 600000)))
      throw new RequestError("Try again in ten minutes.", 429);
    const b = await readJson(request, 1500),
      code = str(b.code, 80),
      now = Date.now();
    const campaign = await first(
      env.DB,
      `SELECT c.* FROM guest_campaigns c JOIN guest_settings g ON g.id='main' WHERE g.enabled=1 AND c.active=1 AND c.code_hash=? AND c.starts_at<=? AND c.ends_at>?`,
      await codeHash(code),
      now,
      now,
    );
    if (!campaign)
      throw new RequestError(
        "This campaign code is unavailable. Check the code and campaign dates.",
        403,
      );
    const sid = uid();
    await batchAtomic(env.DB, [
      guard(
        env.DB,
        "EXISTS(SELECT 1 FROM guest_campaigns c JOIN guest_settings g ON g.id='main' WHERE c.id=? AND c.version=? AND g.enabled=1 AND c.active=1 AND c.code_hash IS NOT NULL AND c.starts_at<=? AND c.ends_at>?)",
        campaign.id,
        campaign.version,
        now,
        now,
      ),
      stmt(
        env.DB,
        "INSERT INTO guest_sessions(id,campaign_id,code_version,expires_at,created_at) VALUES(?,?,?,?,?)",
        sid,
        campaign.id,
        campaign.code_version,
        now + SESSION_SECONDS * 1000,
        now,
      ),
    ]);
    const response = json({ ok: true });
    response.headers.set(
      "Set-Cookie",
      cookie(
        GUEST_COOKIE,
        await signedToken(env.GEAR_SESSION_SECRET!, {
          scope: "campaign",
          sid,
          cid: campaign.id,
        }),
      ),
    );
    return response;
  }
  if (path === "/api/resume" && request.method === "POST") {
    if (!(await rateLimit(env.DB, "gear-receipt:" + ip, 8, 600000)))
      throw new RequestError("Try again in ten minutes.", 429);
    const b = await readJson(request, 1500),
      order = await first(
        env.DB,
        "SELECT g.order_id FROM guest_orders g JOIN orders o ON o.id=g.order_id WHERE o.code=? AND g.receipt_hash=?",
        str(b.code, 80).toUpperCase(),
        await receiptHash(str(b.secret, 100)),
      );
    if (!order)
      throw new RequestError("Those receipt details were not recognized.", 403);
    const response = json({ orderId: order.order_id });
    response.headers.set(
      "Set-Cookie",
      cookie(
        RECEIPT_COOKIE,
        await signedToken(env.GEAR_SESSION_SECRET!, {
          scope: "receipt",
          oid: order.order_id,
        }),
      ),
    );
    return response;
  }
  if (path === "/api/receipt" && request.method === "GET") {
    const id = str(url.searchParams.get("id") || "", 80),
      receipt = await verifiedToken(
        env.GEAR_SESSION_SECRET!,
        readCookie(request, RECEIPT_COOKIE),
        "receipt",
      );
    let allowed = receipt?.oid === id;
    if (!allowed) {
      try {
        const s = await sessionFor(
          env.DB,
          await verifiedToken(
            env.GEAR_SESSION_SECRET!,
            readCookie(request, GUEST_COOKIE),
            "campaign",
          ),
          false,
        );
        allowed = !!(await first(
          env.DB,
          "SELECT 1 FROM guest_orders WHERE order_id=? AND session_id=?",
          id,
          s.session_id,
        ));
      } catch {}
    }
    if (!allowed)
      throw new RequestError("Open this order with your receipt details.", 403);
    return json(await guestReceipt(env.DB, id));
  }
  const session = await sessionFor(
    env.DB,
    await verifiedToken(
      env.GEAR_SESSION_SECRET!,
      readCookie(request, GUEST_COOKIE),
      "campaign",
    ),
  );
  if (
    !(await rateLimit(env.DB, "gear-session:" + session.session_id, 80, 60000))
  )
    throw new RequestError("Try again in one minute.", 429);
  if (path === "/api/catalog" && request.method === "GET") {
    const settings = await first(
      env.DB,
      "SELECT cashtag,cash_instructions FROM settings WHERE id='main'",
    );
    const orders = await rows(
      env.DB,
      "SELECT o.id,o.code,g.state FROM orders o JOIN guest_orders g ON g.order_id=o.id WHERE g.session_id=? ORDER BY g.created_at DESC LIMIT 20",
      session.session_id,
    );
    return json({
      campaign: {
        name: session.name,
        description: session.description,
        endsAt: session.ends_at,
        pickupNote: session.pickup_note,
        reservationHours: session.reservation_hours,
        shippingCap: session.shipping_cap,
        freeShippingThreshold: session.free_shipping_threshold,
      },
      items: publicCatalog(await campaignCatalog(env.DB, session.id)),
      settings,
      orders,
    });
  }
  if (path === "/media" && request.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!/^[a-f0-9-]{36}$/.test(id)) return new Response(null, { status: 404 });
    const image = "/api/product-images?id=" + id,
      items = await campaignCatalog(env.DB, session.id);
    if (
      !items.some(
        (p) =>
          p.image === image || JSON.parse(p.images || "[]").includes(image),
      )
    )
      return new Response(null, { status: 404 });
    const object = await env.BUCKET.get("products/" + id);
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type":
          object.httpMetadata?.contentType || "application/octet-stream",
      },
    });
  }
  if (path === "/api/quote" && request.method === "POST") {
    const q = await guestQuote(env.DB, session, await readJson(request, 12000));
    return json({
      subtotal: q.subtotal,
      shipping: q.shipping,
      total: q.total,
      tax: q.tax,
    });
  }
  if (path === "/api/orders" && request.method === "POST") {
    if (
      !(await rateLimit(
        env.DB,
        "gear-orders:" + session.session_id,
        10,
        600000,
      ))
    )
      throw new RequestError("Try again in ten minutes.", 429);
    const b = await readJson(request, 16000),
      secret = str(b.receiptSecret, 100);
    if (!/^[A-F0-9]{48}$/.test(secret))
      throw new RequestError("Refresh this checkout before submitting.", 400);
    const result = await submitGuestOrder(env.DB, session, b, secret),
      r = json({ ...result, ...(await guestReceipt(env.DB, result.orderId)) });
    r.headers.set(
      "Set-Cookie",
      cookie(
        RECEIPT_COOKIE,
        await signedToken(env.GEAR_SESSION_SECRET!, {
          scope: "receipt",
          oid: result.orderId,
        }),
      ),
    );
    return r;
  }
  return new Response(null, { status: 405 });
}
export default {
  async fetch(request: Request, env: GearEnv) {
    let response: Response;
    try {
      response = await handle(request, env);
    } catch (e) {
      response = json(
        {
          error:
            e instanceof PilotError || e instanceof RequestError
              ? e.message
              : "Gear ordering is temporarily unavailable. Keep this page open and retry.",
        },
        e instanceof PilotError || e instanceof RequestError ? e.status : 503,
      );
    }
    const result = new Response(response.body, response);
    for (const [key, value] of Object.entries(noStore))
      result.headers.set(key, value);
    return result;
  },
  async scheduled(
    _event: ScheduledController,
    env: GearEnv,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        await expireGuestOrders(env.DB, 3);
        await env.DB.prepare(
          "DELETE FROM guest_sessions WHERE id IN(SELECT id FROM guest_sessions WHERE expires_at<? LIMIT 300)",
        )
          .bind(Date.now())
          .run();
      })(),
    );
  },
} satisfies ExportedHandler<GearEnv>;
