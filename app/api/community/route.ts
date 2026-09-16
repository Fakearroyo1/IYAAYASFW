import { env } from "cloudflare:workers";
import { getUser } from "@/app/auth";
import { identity, PilotError } from "@/lib/pilot/service";
import {
  communityPage,
  mutateCommunity,
  COMMUNITY_ADMIN_ACTIONS,
} from "@/lib/pilot/community";
import { readJson, RequestError } from "@/lib/security/http";
import { rateLimit } from "@/lib/auth/session";
import { adminVerified, requireAdminAccess } from "@/lib/security/admin-access";
export const dynamic = "force-dynamic";
const json = (v: unknown, status = 200) =>
  Response.json(v, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const error = (e: unknown) =>
  json(
    {
      error:
        e instanceof RequestError || e instanceof PilotError
          ? e.message
          : "The board could not be updated. Try again.",
    },
    e instanceof RequestError || e instanceof PilotError ? e.status : 503,
  );
export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) throw new RequestError("Sign in to view the board.", 401);
    if (!env.DB) throw new RequestError("The store is unavailable.", 503);
    if (
      !(await rateLimit(env.DB, "community-read:" + user.memberId, 90, 60000))
    )
      throw new RequestError("Try again in one minute.", 429);
    const q = Object.fromEntries(new URL(request.url).searchParams),
      admin = await adminVerified(env.DB, user);
    if (["team", "reports"].includes(q.kind))
      await requireAdminAccess(env.DB, user);
    const m = await identity(env.DB, user);
    if (!m) throw new RequestError("Member access is required.", 403);
    return json(await communityPage(env.DB, m, q, admin));
  } catch (e) {
    return error(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) throw new RequestError("Sign in to post.", 401);
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new RequestError("Open the store and try again.", 403);
    const b = await readJson(request, 12000);
    if (!env.DB) throw new RequestError("The store is unavailable.", 503);
    if (
      !(await rateLimit(env.DB, "community-write:" + user.memberId, 30, 60000))
    )
      throw new RequestError("Too many changes. Try again in one minute.", 429);
    if (COMMUNITY_ADMIN_ACTIONS.includes(b.action))
      await requireAdminAccess(env.DB, user);
    const m = await identity(env.DB, user);
    if (!m) throw new RequestError("Member access is required.", 403);
    return json(await mutateCommunity(env.DB, m, b, user.tokenHash));
  } catch (e) {
    return error(e);
  }
}
