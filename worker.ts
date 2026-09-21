import handler from "vinext/server/fetch-handler";
import {identityRoute,identityHost} from './lib/identity/router';
import {config,verifyCsrf} from './lib/identity/common';
import {accessPrincipal,readSession} from './lib/identity/sessions';
import {cleanIdentityMetadata} from './lib/identity/retention';
import {RequestError} from './lib/security/http';
// This app uses explicit JSON APIs, not Server Actions. Keep the unused decoder
// unreachable and apply browser protections before entering the framework.
export default {
  async scheduled(
    _event: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ) {
    if(env.DB)ctx.waitUntil((async()=>{await cleanExpiredSecurityRecords(env.DB!);if(env.IDENTITY_ENABLED==='true')await cleanIdentityMetadata(env.DB!,env);})());
  },
  async fetch(
    request: Request,
    env: Cloudflare.Env,
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
    headers.delete('x-identity-audience');
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
      "/api/roadmap",
      "/api/profile-images",
    ].includes(path);
    let response: Response|undefined;
    try{
      const identity=config(env),url=new URL(request.url),host=identityHost(env,url);
      let principal;
      if(identity.enabled){
        if(!host)throw new RequestError('Unknown application host.',421);
        headers.set('x-identity-audience',host==='admin'?'admin':'member');
        if(host==='admin'){
          if(!env.DB)throw new RequestError('Administrator sign-in is unavailable.',503);
          principal=await accessPrincipal(env.DB,env,request);
          const user=await readSession(env.DB,request,'admin');
          if(user&&user.principalId!==principal.id)throw new RequestError('Administrator accounts do not match.',403);
          if(!user&&!['/identity','/identity/api','/theme.js'].includes(path)&&!/^\/(?:_next|_vinext|assets|brand)\//.test(path))response=Response.redirect(identity.admin+'/identity',303);
          if(path==='/login')response=Response.redirect(identity.admin+'/identity',303);
        }
        if((host==='auth'||host==='register')&&path==='/')response=Response.redirect(url.origin+'/identity',303);
        if(host==='auth'&&path==='/identity'&&request.method==='GET'&&!url.searchParams.has('flow')&&!url.searchParams.has('error'))response=Response.redirect(identity.member+'/login?next='+encodeURIComponent(url.searchParams.get('next')||'/'),303);
        if(path==='/api/admin/access'&&(env.IDENTITY_ROLLOUT==='all-approved'||host!=='member'))response=host==='member'?Response.redirect(identity.admin+'/identity',303):new Response('Use administrator sign-in.',{status:405});
        if(request.method==='POST'&&write)verifyCsrf(request);
      }
      if(!response)response=(await identityRoute(request,env,principal))||undefined;
      if(identity.enabled&&(host==='auth'||host==='register')&&!response&&path!=='/identity'&&!/^\/(?:_next|_vinext|assets|brand)\//.test(path)&&path!=='/theme.js')response=new Response('Not found.',{status:404});
    }catch(e){response=Response.json({error:e instanceof RequestError?e.message:'Sign-in is temporarily unavailable.'},{status:e instanceof RequestError?e.status:503});}
    const actionHeader =
      request.headers.has("next-action") || request.headers.has("x-rsc-action");
    if (!response&&request.method === "POST" && actionHeader)
      response = new Response("Server Actions are not supported.", {
        status: 405,
      });
    else if (!response&&imageOptimizer)
      response = new Response("Not found.", { status: 404 });
    else if (
      !response&&!["GET", "HEAD"].includes(request.method) &&
      !(request.method === "POST" && write)
    )
      response = new Response("Method not allowed.", {
        status: 405,
        headers: { Allow: write ? "GET, HEAD, POST" : "GET, HEAD" },
      });
    else if(!response)
      response = await handler.fetch(
        new Request(request, { headers }),
        env,
        ctx,
      );
    const resolved=response||new Response('Service unavailable.',{status:503});
    const output = new Response(resolved.body, resolved);
    output.headers.set("Content-Security-Policy", csp);
    output.headers.set("X-Frame-Options", "DENY");
    output.headers.set("X-Content-Type-Options", "nosniff");
    output.headers.set("Referrer-Policy", "no-referrer");
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
