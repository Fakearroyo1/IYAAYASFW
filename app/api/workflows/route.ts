import { env } from "cloudflare:workers";
import { getUser } from "@/app/auth";
import { identity, PilotError } from "@/lib/pilot/service";
import { requireAdminAccess } from "@/lib/security/admin-access";
import { rateLimit } from "@/lib/auth/session";
import { readJson, RequestError } from "@/lib/security/http";
import { rows, first } from "@/lib/pilot/core";
import { dateRange } from "@/lib/pilot/history";
import { MONEY_ACTIONS, mutateMoney, moneyHistory } from "@/lib/pilot/money";
import {
  PURCHASE_ACTIONS,
  mutatePurchasing,
  planningCatalog,
  runDetail,
  runHistory,
  fundsProjection,
  purchaseOptions,
} from "@/lib/pilot/purchasing";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const failure = (e: unknown) =>
  json(
    {
      error:
        e instanceof PilotError || e instanceof RequestError
          ? e.message
          : "The action could not be confirmed. Keep your input and retry the same request.",
    },
    e instanceof PilotError || e instanceof RequestError ? e.status : 503,
  );
async function authorized() {
  const user = await getUser();
  if (!user) throw new RequestError("Sign in to continue.", 401);
  if (!env.DB) throw new RequestError("The store is unavailable.", 503);
  await requireAdminAccess(env.DB, user);
  const member = await identity(env.DB, user);
  if (!member || member.role !== "admin")
    throw new RequestError("Administrator access is required.", 403);
  return { user, member, db: env.DB };
}
export async function GET(request: Request) {
  try {
    const { user, db } = await authorized();
    if (!(await rateLimit(db, "workflow-read:" + user.memberId, 90, 60000)))
      throw new RequestError("Try again in one minute.", 429);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    if (q.view === "catalog") return json(await planningCatalog(db));
    if (q.view === "run") return json(await runDetail(db, q.id));
    if (q.view === "runs") return json(await runHistory(db, q));
    if (q.view === "purchaseOptions")
      return json({ options: await purchaseOptions(db, q.productId) });
    if (q.view === "money") {
      const { start, end } = dateRange(q.from, q.to);
      return json({
        ...(await fundsProjection(db)),
        history: await moneyHistory(db, q),
        openRuns: await rows(
          db,
          "SELECT r.id,r.name FROM restock_runs r JOIN workflow_runs w ON w.run_id=r.id WHERE w.stage IN('planning','shopping') AND NOT EXISTS(SELECT 1 FROM purchase_receipts p WHERE p.run_id=r.id) ORDER BY r.created_at DESC",
        ),
        period: await rows(
          db,
          "SELECT account_id,category,SUM(CASE WHEN amount>0 THEN amount ELSE 0 END) inflow,SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END) outflow FROM money_movements WHERE effective_at>=? AND effective_at<? GROUP BY account_id,category",
          start,
          end,
        ),
        pending: await rows(
          db,
          "SELECT p.id,p.method,p.amount,p.created_at,m.name FROM payments p LEFT JOIN members m ON m.id=p.member_id WHERE p.status='pending' AND p.method IN('cash','cashapp') ORDER BY p.created_at LIMIT 100",
        ),
        missingCosts: await rows(
          db,
          "SELECT i.id,i.product_id,i.name,i.remaining_qty,o.code,o.created_at FROM item_balances i JOIN orders o ON o.id=i.order_id WHERE i.cost IS NULL AND i.custom=0 AND i.remaining_qty>0 AND o.status<>'void' AND NOT EXISTS(SELECT 1 FROM sale_cost_corrections c WHERE c.item_id=i.id) ORDER BY o.created_at,i.id LIMIT 100",
        ),
        missingCostCount: (await first(
          db,
          "SELECT COUNT(*) n FROM item_balances i JOIN orders o ON o.id=i.order_id WHERE i.cost IS NULL AND i.custom=0 AND i.remaining_qty>0 AND o.status<>'void' AND NOT EXISTS(SELECT 1 FROM sale_cost_corrections c WHERE c.item_id=i.id)",
        ))!.n,
      });
    }
    throw new RequestError("Choose a supported workflow.", 400);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const { user, member, db } = await authorized();
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new RequestError("Open the store and try again.", 403);
    const body = await readJson(request, 128000);
    if (!(await rateLimit(db, "workflow-write:" + user.memberId, 90, 60000)))
      throw new RequestError("Too many changes. Try again in one minute.", 429);
    if (MONEY_ACTIONS.includes(body.action))
      return json(await mutateMoney(db, member, body, user.tokenHash));
    if (PURCHASE_ACTIONS.includes(body.action))
      return json(await mutatePurchasing(db, member, body, user.tokenHash));
    throw new RequestError("Choose a supported action.", 400);
  } catch (e) {
    return failure(e);
  }
}
