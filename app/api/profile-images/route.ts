import { env } from "cloudflare:workers";
import { getUser } from "@/app/auth";
import { adminVerified } from "@/lib/security/admin-access";
import { RequestError } from "@/lib/security/http";
import { rateLimit } from "@/lib/auth/session";
import {
  PilotError,
  first,
  stmt,
  guard,
  audit,
  batchAtomic,
  sessionGuard,
  uid,
} from "@/lib/pilot/core";
import { rewardTotal, unlockedTier } from "@/lib/pilot/rewards";
import { safePng } from "@/lib/profile/png";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new RequestError("Open your profile and try again.", 403);
    const u = await getUser();
    if (!u) throw new RequestError("Sign in to continue.", 401);
    if (!env.DB || !env.BUCKET)
      throw new RequestError("Image storage is unavailable.", 503);
    if (!(await rateLimit(env.DB, "profile-upload:" + u.memberId, 4, 600000)))
      throw new RequestError("Try again in ten minutes.", 429);
    const kind = new URL(request.url).searchParams.get("kind");
    if (!["avatar", "banner"].includes(kind || ""))
      throw new RequestError("Choose an avatar or banner.", 400);
    const settings = (await first(
        env.DB,
        "SELECT * FROM reward_settings WHERE id='main'",
      ))!,
      total = await rewardTotal(env.DB, u.memberId),
      tier = unlockedTier(settings, total);
    if (!tier[kind!])
      throw new RequestError(
        "This image customization has not unlocked yet.",
        403,
      );
    if (request.headers.get("content-type") !== "image/png")
      throw new RequestError("Use the profile photo picker.", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new RequestError("Choose an image.", 400);
    let length = 0,
      timedOut = false;
    const chunks: Uint8Array[] = [];
    const timeout = setTimeout(() => {
      timedOut = true;
      void reader.cancel();
    }, 10000);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new RequestError("Choose a smaller image.", 413);
        }
        chunks.push(value);
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
    if (timedOut) throw new RequestError("Upload timed out.", 408);
    const image = await safePng(
        new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer()),
        kind!,
      ),
      id = uid(),
      key = "profiles/" + id;
    await env.BUCKET.put(key, image.bytes, {
      httpMetadata: { contentType: "image/png" },
    });
    try {
      await batchAtomic(env.DB, [
        ...sessionGuard(env.DB, u.memberId, u.tokenHash),
        guard(
          env.DB,
          "EXISTS(SELECT 1 FROM reward_settings WHERE id='main' AND version=?)",
          settings.version,
        ),
        guard(
          env.DB,
          "(SELECT COALESCE(SUM(amount),0) FROM reward_ledger WHERE member_id=?)=?",
          u.memberId,
          total,
        ),
        stmt(
          env.DB,
          "INSERT INTO profile_images(id,member_id,kind,object_key,width,height,created_at) VALUES(?,?,?,?,?,?,?)",
          id,
          u.memberId,
          kind,
          key,
          image.width,
          image.height,
          Date.now(),
        ),
        audit(env.DB, u.memberId, "profile_image_uploaded", id, { kind }),
      ]);
    } catch (e) {
      await env.BUCKET.delete(key);
      throw e;
    }
    return Response.json({ id }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof PilotError || e instanceof RequestError
            ? e.message
            : "The image could not be saved.",
      },
      {
        status:
          e instanceof PilotError || e instanceof RequestError ? e.status : 503,
      },
    );
  }
}
export async function GET(request: Request) {
  try {
    const u = await getUser();
    if (!u) return new Response(null, { status: 401 });
    if (!env.DB || !env.BUCKET) return new Response(null, { status: 503 });
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[a-f0-9-]{36}$/.test(id)) return new Response(null, { status: 404 });
    const image = await first(
      env.DB,
      "SELECT * FROM profile_images WHERE id=? AND removed=0",
      id,
    );
    if (!image) return new Response(null, { status: 404 });
    if (image.member_id !== u.memberId && !(await adminVerified(env.DB, u))) {
      const p = await first(
        env.DB,
        "SELECT p.member_id FROM member_profiles p JOIN members m ON m.id=p.member_id JOIN profile_approved_content a ON a.member_id=p.member_id WHERE p.member_id=? AND p.visible=1 AND p.moderation<>'hidden' AND m.active=1 AND (a.avatar_id=? OR a.banner_id=?)",
        image.member_id,
        id,
        id,
      );
      if (!p) return new Response(null, { status: 404 });
      const settings = (await first(
          env.DB,
          "SELECT * FROM reward_settings WHERE id='main'",
        ))!,
        tier = unlockedTier(
          settings,
          await rewardTotal(env.DB, image.member_id),
        );
      if (!tier[image.kind]) return new Response(null, { status: 404 });
    }
    const object = await env.BUCKET.get(image.object_key);
    return object
      ? new Response(object.body, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        })
      : new Response(null, { status: 404 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
