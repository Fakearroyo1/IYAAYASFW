import { env } from "cloudflare:workers";
import { getUser } from "@/app/auth";
import { identity, PilotError } from "@/lib/pilot/service";
import { rateLimit } from "@/lib/auth/session";
import { requireAdminAccess } from "@/lib/security/admin-access";
import { readJson, RequestError } from "@/lib/security/http";
import { guestAdmin, mutateGuest, GUEST_ACTIONS } from "@/lib/pilot/guest";
import {
  autopilotPage,
  mutateInventory,
  INVENTORY_ACTIONS,
} from "@/lib/pilot/autopilot";
import {
  rewardsPage,
  mutateRewards,
  REWARD_ADMIN_ACTIONS,
  PROFILE_ACTIONS,
} from "@/lib/pilot/rewards";
export const dynamic = "force-dynamic";
const json = (v: unknown, status = 200) =>
  Response.json(v, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const failure = (e: unknown) =>
  json(
    {
      error:
        e instanceof PilotError || e instanceof RequestError
          ? e.message
          : "The update could not be confirmed. Keep this page open and retry.",
    },
    e instanceof PilotError || e instanceof RequestError ? e.status : 503,
  );
export async function GET(request: Request) {
  try {
    const u = await getUser();
    if (!u) throw new RequestError("Sign in to continue.", 401);
    if (!env.DB) throw new RequestError("The store is unavailable.", 503);
    if (!(await rateLimit(env.DB, "roadmap-read:" + u.memberId, 60, 60000)))
      throw new RequestError("Try again in one minute.", 429);
    const q = Object.fromEntries(new URL(request.url).searchParams),
      m = await identity(env.DB, u);
    if (!m) throw new RequestError("Member access is required.", 403);
    const admin =
      q.admin === "true" || ["guest", "inventory", "month"].includes(q.kind);
    if (admin) await requireAdminAccess(env.DB, u);
    if (q.kind === "guest") return json(await guestAdmin(env.DB, q));
    if (q.kind === "inventory" || q.kind === "month")
      return json(await autopilotPage(env.DB, q));
    if (q.kind === "rewards" || q.kind === "profile")
      return json(await rewardsPage(env.DB, m, q, admin));
    throw new RequestError("Choose a supported view.", 400);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const u = await getUser();
    if (!u) throw new RequestError("Sign in to continue.", 401);
    if (!env.DB) throw new RequestError("The store is unavailable.", 503);
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new RequestError("Open the store and try again.", 403);
    const b = await readJson(request, 24000),
      admin = [
        ...GUEST_ACTIONS,
        ...INVENTORY_ACTIONS,
        ...REWARD_ADMIN_ACTIONS,
      ].includes(b.action);
    if (!admin && !PROFILE_ACTIONS.includes(b.action))
      throw new RequestError("Choose a supported action.", 400);
    if (admin) await requireAdminAccess(env.DB, u);
    if (!(await rateLimit(env.DB, "roadmap-write:" + u.memberId, 30, 60000)))
      throw new RequestError("Too many changes. Try again in one minute.", 429);
    if (
      b.action === "profileReport" &&
      !(await rateLimit(env.DB, "profile-report:" + u.memberId, 5, 600000))
    )
      throw new RequestError("Try again in ten minutes.", 429);
    const m = await identity(env.DB, u);
    if (!m) throw new RequestError("Member access is required.", 403);
    if (GUEST_ACTIONS.includes(b.action))
      return json(await mutateGuest(env.DB, m, b, u.tokenHash));
    if (INVENTORY_ACTIONS.includes(b.action))
      return json(await mutateInventory(env.DB, m, b, u.tokenHash));
    return json(await mutateRewards(env.DB, m, b, u.tokenHash));
  } catch (e) {
    return failure(e);
  }
}
