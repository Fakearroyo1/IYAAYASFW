import handler from "vinext/server/fetch-handler";
// This app uses explicit JSON APIs, not Server Actions. Keep the unused decoder
// unreachable and apply browser protections before entering the framework.
export default {
  async scheduled(
    _event: ScheduledController,
    env: { DB: D1Database },
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(cleanExpiredSecurityRecords(env.DB));
  },
  async fetch(
    request: Request,
    env: unknown,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    const headers = new Headers(request.headers);
    // A caller-supplied CSP must never select the nonce used in our HTML.
    headers.delete("content-security-policy-report-only");
    headers.set("content-security-policy", csp);
    const path = new URL(request.url).pathname;
    // No product uses the framework image optimizer. Keep its remote-fetch and
    // optional format decoders outside this application's request surface.
    const imageOptimizer = /^\/(?:_next|_vinext)\/image\/?$/.test(path);
    const write = [
      "/api/auth",
      "/api/pilot",
      "/api/product-images",
      "/api/community",
      "/api/operations",
    ].includes(path);
    let response: Response;
    const actionHeader =
      request.headers.has("next-action") || request.headers.has("x-rsc-action");
    if (request.method === "POST" && actionHeader)
      response = new Response("Server Actions are not supported.", {
        status: 405,
      });
    else if (imageOptimizer)
      response = new Response("Not found.", { status: 404 });
    else if (
      !["GET", "HEAD"].includes(request.method) &&
      !(request.method === "POST" && write)
    )
      response = new Response("Method not allowed.", {
        status: 405,
        headers: { Allow: write ? "GET, HEAD, POST" : "GET, HEAD" },
      });
    else
      response = await handler.fetch(
        new Request(request, { headers }),
        env,
        ctx,
      );
    const output = new Response(response.body, response);
    output.headers.set("Content-Security-Policy", csp);
    output.headers.set("X-Frame-Options", "DENY");
    output.headers.set("X-Content-Type-Options", "nosniff");
    output.headers.set("Referrer-Policy", "same-origin");
    output.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    output.headers.set("Strict-Transport-Security", "max-age=31536000");
    output.headers.set("Cache-Control", "private, no-store");
    return output;
  },
};

// Bounded maintenance affects only expired authentication records. Business,
// financial, audit, and pending recovery-request records are never pruned.
async function cleanExpiredSecurityRecords(db: D1Database) {
  const now = Date.now();
  for (const [table, key] of [
    ["auth_limits", "id"],
    ["auth_admin_access", "token_hash"],
    ["auth_setup", "member_id"],
    ["auth_recovery", "member_id"],
  ]) {
    await db
      .prepare(
        `DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE expires_at<? LIMIT 500)`,
      )
      .bind(now)
      .run();
  }
  await db
    .prepare(
      "DELETE FROM auth_sessions WHERE token_hash IN (SELECT s.token_hash FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.expires_at<? OR s.created_at<?-CASE WHEN m.role='admin' THEN 43200000 ELSE 2592000000 END LIMIT 500)",
    )
    .bind(now, now)
    .run();
}
