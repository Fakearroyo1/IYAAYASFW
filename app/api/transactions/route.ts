import { env } from "cloudflare:workers";
import { getUser } from "@/app/auth";
import { requireAdminAccess } from "@/lib/security/admin-access";
import { RequestError } from "@/lib/security/http";
import { rateLimit } from "@/lib/auth/session";
import { PilotError, first } from "@/lib/pilot/core";
import { transactionDetail } from "@/lib/pilot/transactions";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) throw new RequestError("Sign in to view transactions.", 401);
    if (!env.DB) throw new RequestError("The store is unavailable.", 503);
    await requireAdminAccess(env.DB, user);
    if (!(await rateLimit(env.DB, "transactions:" + user.memberId, 60, 60000)))
      throw new RequestError("Try again in one minute.", 429);
    const query = new URL(request.url).searchParams;
    const paymentId = query.get("paymentId");
    if (paymentId) {
      if (paymentId.length > 80)
        throw new RequestError("Invalid payment.", 400);
      const payment = await first(
        env.DB,
        "SELECT * FROM payment_balances WHERE id=?",
        paymentId,
      );
      if (!payment) throw new RequestError("Payment not found.", 404);
      const member = payment.member_id
        ? await first(
            env.DB,
            "SELECT id,name,debt,credit FROM members WHERE id=?",
            payment.member_id,
          )
        : null;
      return Response.json(
        { payment, member },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      await transactionDetail(env.DB, query.get("id") || ""),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof RequestError || e instanceof PilotError
            ? e.message
            : "The transaction could not load.",
      },
      {
        status:
          e instanceof RequestError || e instanceof PilotError ? e.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
