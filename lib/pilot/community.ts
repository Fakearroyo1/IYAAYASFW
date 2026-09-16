import {
  type DB,
  type Row,
  fail,
  int,
  str,
  reqId,
  first,
  rows,
  stmt,
  audit,
  guard,
  hash,
  batchAtomic,
  sessionGuard,
} from "./core";
import { accessFor, canShop } from "./access";
import { cursorFor, cursorValue } from "./history";
export const COMMUNITY_ADMIN_ACTIONS = [
  "requestDecision",
  "removePost",
  "resolveReport",
  "teamCreate",
  "teamReply",
  "teamUpdate",
];
export const PURCHASE_CHECK =
  "EXISTS(SELECT 1 FROM item_balances bi JOIN orders bo ON bo.id=bi.order_id WHERE bi.product_id=product_reviews.product_id AND bo.member_id=product_reviews.member_id AND bo.status IN('paid','tab') AND bi.remaining_qty>0)";
export async function purchased(db: DB, memberId: string, productId: string) {
  return !!(await first(
    db,
    "SELECT bi.id FROM item_balances bi JOIN orders bo ON bo.id=bi.order_id WHERE bi.product_id=? AND bo.member_id=? AND bo.status IN('paid','tab') AND bi.remaining_qty>0 LIMIT 1",
    productId,
    memberId,
  ));
}
async function checkShop(db: DB, m: Row, shop: string) {
  if (
    !["snacks", "gear"].includes(shop) ||
    !canShop(
      m as any,
      await accessFor(db, m as any),
      shop === "gear" ? "Gear" : "Snacks",
    )
  )
    fail("This shop is not available for your account.", 403);
}
async function productShop(db: DB, m: Row, id: string) {
  const p = await first(
    db,
    "SELECT p.id,p.category,p.active,COALESCE(d.archived,0) archived FROM products p LEFT JOIN product_details d ON d.product_id=p.id WHERE p.id=?",
    id,
  );
  if (!p || !p.active || p.archived) fail("Product unavailable.", 404);
  const shop = p.category === "Gear" ? "gear" : "snacks";
  await checkShop(db, m, shop);
  return shop;
}
const cleanText = (v: unknown, max: number, min = 0) => {
  const text = str(v, max);
  if (text.length < min || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
    fail("Enter valid text of at least " + min + " characters.");
  return text;
};
const pageTail = (cursor: string | undefined, alias: string) => {
  const c = cursorValue(cursor);
  return c
    ? {
        sql:
          " AND (" +
          alias +
          ".created_at<? OR (" +
          alias +
          ".created_at=? AND " +
          alias +
          ".id<?))",
        values: [c.t, c.t, c.id],
      }
    : { sql: "", values: [] };
};
const page = (found: Row[], limit = 30) => ({
  records: found.slice(0, limit),
  nextCursor: found.length > limit ? cursorFor(found[limit - 1]) : null,
});
export async function communityPage(db: DB, m: Row, q: Row, admin = false) {
  const kind = q.kind || "requests";
  if (kind === "requests") {
    const shop = q.shop || "snacks";
    await checkShop(db, m, shop);
    const tail = pageTail(q.cursor, "r");
    const found = await rows(
      db,
      "SELECT r.*,m.name author_name,COALESCE(v.likes,0) likes,COALESCE(v.dislikes,0) dislikes,COALESCE(mine.value,0) my_vote FROM item_requests r JOIN members m ON m.id=r.member_id LEFT JOIN (SELECT request_id,SUM(value=1) likes,SUM(value=-1) dislikes FROM request_votes GROUP BY request_id) v ON v.request_id=r.id LEFT JOIN request_votes mine ON mine.request_id=r.id AND mine.member_id=? WHERE r.shop=? AND r.removed=0" +
        tail.sql +
        " ORDER BY r.created_at DESC,r.id DESC LIMIT 31",
      m.id,
      shop,
      ...tail.values,
    );
    return {
      ...page(found),
      postingEnabled: !!m.posting_enabled,
      memberId: m.id,
      admin,
      shop,
    };
  }
  if (kind === "reviews") {
    const id = str(q.productId, 80);
    await productShop(db, m, id);
    const tail = pageTail(q.cursor, "product_reviews");
    const [found, summary, mine, eligible] = await Promise.all([
      rows(
        db,
        "SELECT product_reviews.*,m.name author_name,1 verified_purchase FROM product_reviews JOIN members m ON m.id=product_reviews.member_id WHERE product_reviews.product_id=? AND product_reviews.removed=0 AND " +
          PURCHASE_CHECK +
          tail.sql +
          " ORDER BY product_reviews.created_at DESC,product_reviews.id DESC LIMIT 31",
        id,
        ...tail.values,
      ),
      first(
        db,
        "SELECT COUNT(*) count,AVG(rating) average FROM product_reviews WHERE product_id=? AND removed=0 AND " +
          PURCHASE_CHECK,
        id,
      ),
      first(
        db,
        "SELECT id,rating,body,version,removed FROM product_reviews WHERE product_id=? AND member_id=?",
        id,
        m.id,
      ),
      purchased(db, m.id, id),
    ]);
    return {
      ...page(found),
      summary,
      mine: mine?.removed ? null : mine,
      canReview: eligible && !!m.posting_enabled && !mine?.removed,
      postingEnabled: !!m.posting_enabled,
      memberId: m.id,
      admin,
    };
  }
  if (!admin || m.role !== "admin")
    fail("Verified administrator access is required.", 403);
  if (kind === "reports") {
    const found = await rows(
      db,
      "SELECT r.*,m.name reporter_name,COALESCE(ir.title,p.name) title,COALESCE(ir.body,pr.body) body,COALESCE(ir.version,pr.version) post_version,COALESCE(ir.removed,pr.removed,1) removed,COALESCE(ir.member_id,pr.member_id) author_id,(SELECT name FROM members WHERE id=COALESCE(ir.member_id,pr.member_id)) author_name FROM community_reports r JOIN members m ON m.id=r.member_id LEFT JOIN item_requests ir ON r.kind='request' AND ir.id=r.target LEFT JOIN product_reviews pr ON r.kind='review' AND pr.id=r.target LEFT JOIN products p ON p.id=pr.product_id WHERE r.status='open' ORDER BY r.created_at,r.id LIMIT 100",
    );
    return { records: found };
  }
  if (kind === "team") {
    const tail = pageTail(q.cursor, "t"),
      found = await rows(
        db,
        "SELECT t.*,m.name author_name,(SELECT COUNT(*) FROM team_replies r WHERE r.message_id=t.id) reply_count FROM team_messages t JOIN members m ON m.id=t.actor WHERE t.removed=0" +
          tail.sql +
          " ORDER BY t.created_at DESC,t.id DESC LIMIT 31",
        ...tail.values,
      );
    let replies: Row[] = [],
      thread: Row | null = null;
    if (q.threadId) {
      thread = await first(
        db,
        "SELECT t.*,m.name author_name FROM team_messages t JOIN members m ON m.id=t.actor WHERE t.id=? AND t.removed=0",
        str(q.threadId, 80),
      );
      if (thread)
        replies = await rows(
          db,
          "SELECT r.*,m.name author_name FROM team_replies r JOIN members m ON m.id=r.actor WHERE r.message_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 100",
          thread.id,
        );
    }
    return { ...page(found), thread, replies: replies.reverse() };
  }
  fail("Choose a supported board.");
}

export async function mutateCommunity(
  db: DB,
  m: Row,
  b: Row,
  tokenHash?: string,
) {
  const action = str(b.action, 40),
    adminAction = COMMUNITY_ADMIN_ACTIONS.includes(action),
    id = reqId(b.requestId),
    fp = await hash({ actor: m.id, body: b });
  if (adminAction && m.role !== "admin")
    fail("Administrator access is required.", 403);
  const prior = await first(
    db,
    "SELECT fingerprint FROM mutations WHERE id=?",
    id,
  );
  if (prior) {
    if (prior.fingerprint !== fp)
      fail("This action identifier was already used.", 409);
    return { ok: true, replayed: true };
  }
  const atomic = async (
    statements: D1PreparedStatement[],
    shop?: string,
    posting = true,
  ) => {
    const checks = [
      ...sessionGuard(db, m.id, tokenHash, adminAction),
      guard(
        db,
        adminAction
          ? "EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND role='admin')"
          : "EXISTS(SELECT 1 FROM members WHERE id=? AND active=1)",
        m.id,
      ),
    ];
    if (!adminAction && posting)
      checks.push(
        guard(
          db,
          "COALESCE((SELECT posting_enabled FROM member_controls WHERE member_id=?),1)=1",
          m.id,
        ),
      );
    if (shop)
      checks.push(
        guard(
          db,
          "EXISTS(SELECT 1 FROM members m LEFT JOIN member_access a ON a.member_id=m.id WHERE m.id=? AND (m.role='admin' OR CASE WHEN ?='gear' THEN COALESCE(a.gear,1) ELSE COALESCE(a.snacks,1) END=1))",
          m.id,
          shop,
        ),
      );
    try {
      await batchAtomic(db, [
        ...checks,
        ...statements,
        stmt(db, "INSERT INTO mutations(id,fingerprint) VALUES(?,?)", id, fp),
      ]);
    } catch (e) {
      const retry = await first(
        db,
        "SELECT fingerprint FROM mutations WHERE id=?",
        id,
      );
      if (retry?.fingerprint === fp) return;
      throw e;
    }
  };
  const now = Date.now();
  if (!adminAction && action !== "report" && !m.posting_enabled)
    fail(
      "Posting has been disabled for this account. Contact the store team.",
      403,
    );
  if (action === "requestCreate" || action === "requestEdit") {
    const shop = str(b.shop, 10);
    await checkShop(db, m, shop);
    const title = cleanText(b.title, 100, 5),
      body = cleanText(b.body || "", 2000);
    if (action === "requestCreate")
      await atomic(
        [
          guard(
            db,
            "(SELECT COUNT(*) FROM item_requests WHERE member_id=? AND created_at>?)<3",
            m.id,
            now - 86400000,
          ),
          stmt(
            db,
            "INSERT INTO item_requests(id,member_id,shop,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            id,
            m.id,
            shop,
            title,
            body,
            now,
            now,
          ),
          audit(db, m.id, "item_requested", id, { shop, title }),
        ],
        shop,
      );
    else {
      const target = str(b.id, 80);
      await atomic(
        [
          guard(
            db,
            "EXISTS(SELECT 1 FROM item_requests WHERE id=? AND member_id=? AND shop=? AND status='open' AND removed=0 AND version=?)",
            target,
            m.id,
            shop,
            int(b.version),
          ),
          stmt(
            db,
            "UPDATE item_requests SET title=?,body=?,version=version+1,updated_at=? WHERE id=?",
            title,
            body,
            now,
            target,
          ),
          audit(db, m.id, "request_edited", target, { title }),
        ],
        shop,
      );
    }
    return { ok: true };
  }
  if (action === "vote") {
    const target = str(b.id, 80),
      value = int(b.value, -1, 1),
      r = await first(
        db,
        "SELECT * FROM item_requests WHERE id=? AND removed=0",
        target,
      );
    if (!r) fail("Request unavailable.", 404);
    await checkShop(db, m, r.shop);
    const statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM item_requests WHERE id=? AND removed=0)",
        target,
      ),
    ];
    if (value === 0)
      statements.push(
        stmt(
          db,
          "DELETE FROM request_votes WHERE request_id=? AND member_id=?",
          target,
          m.id,
        ),
      );
    else
      statements.push(
        stmt(
          db,
          "INSERT INTO request_votes(request_id,member_id,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(request_id,member_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
          target,
          m.id,
          value,
          now,
        ),
      );
    await atomic(statements, r.shop);
    return { ok: true };
  }
  if (action === "reviewSave") {
    const productId = str(b.productId, 80),
      shop = await productShop(db, m, productId),
      rating = int(b.rating, 1, 5),
      body = cleanText(b.body || "", 2000);
    if (!(await purchased(db, m.id, productId)))
      fail("A recorded purchase is required before reviewing this item.", 403);
    const old = await first(
      db,
      "SELECT * FROM product_reviews WHERE product_id=? AND member_id=?",
      productId,
      m.id,
    );
    if (old?.removed)
      fail(
        "This review was removed by an administrator. Contact the store team.",
        403,
      );
    if (old && int(b.version) !== old.version)
      fail("Your review changed. Refresh it before saving.", 409);
    const checks = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM item_balances bi JOIN orders bo ON bo.id=bi.order_id WHERE bi.product_id=? AND bo.member_id=? AND bo.status IN('paid','tab') AND bi.remaining_qty>0)",
        productId,
        m.id,
      ),
      guard(
        db,
        "EXISTS(SELECT 1 FROM products p LEFT JOIN product_details d ON d.product_id=p.id WHERE p.id=? AND p.active=1 AND COALESCE(d.archived,0)=0 AND (CASE WHEN p.category='Gear' THEN 'gear' ELSE 'snacks' END)=?)",
        productId,
        shop,
      ),
    ];
    if (old)
      checks.push(
        guard(
          db,
          "EXISTS(SELECT 1 FROM product_reviews WHERE id=? AND version=? AND removed=0)",
          old.id,
          old.version,
        ),
        stmt(
          db,
          "UPDATE product_reviews SET rating=?,body=?,version=version+1,updated_at=? WHERE id=?",
          rating,
          body,
          now,
          old.id,
        ),
      );
    else
      checks.push(
        guard(
          db,
          "(SELECT COUNT(*) FROM product_reviews WHERE member_id=? AND created_at>?)<10",
          m.id,
          now - 86400000,
        ),
        stmt(
          db,
          "INSERT INTO product_reviews(id,product_id,member_id,rating,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
          id,
          productId,
          m.id,
          rating,
          body,
          now,
          now,
        ),
      );
    checks.push(
      audit(db, m.id, old ? "review_edited" : "review_added", old?.id || id, {
        productId,
        rating,
      }),
    );
    await atomic(checks, shop);
    return { ok: true };
  }
  if (action === "report") {
    const kind = str(b.kind, 10),
      target = str(b.id, 80),
      reason = cleanText(b.reason, 500, 5);
    if (!["request", "review"].includes(kind)) fail("Choose a post to report.");
    const post = await first(
      db,
      kind === "request"
        ? "SELECT * FROM item_requests WHERE id=? AND removed=0"
        : "SELECT * FROM product_reviews WHERE id=? AND removed=0",
      target,
    );
    if (!post) fail("Post unavailable.", 404);
    const shop =
      kind === "request"
        ? post.shop
        : await productShop(db, m, post.product_id);
    await checkShop(db, m, shop);
    await atomic(
      [
        guard(
          db,
          "(SELECT COUNT(*) FROM community_reports WHERE member_id=? AND created_at>?)<5",
          m.id,
          now - 86400000,
        ),
        stmt(
          db,
          "INSERT INTO community_reports(id,member_id,kind,target,reason,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(member_id,kind,target) DO NOTHING",
          id,
          m.id,
          kind,
          target,
          reason,
          now,
        ),
      ],
      shop,
      false,
    );
    return { ok: true };
  }
  if (action === "requestDecision") {
    const target = str(b.id, 80),
      status = str(b.status, 20),
      note = cleanText(b.note || "", 500, 5);
    if (!["open", "accepted", "denied"].includes(status))
      fail("Choose a request status.");
    await atomic([
      guard(
        db,
        "EXISTS(SELECT 1 FROM item_requests WHERE id=? AND version=? AND removed=0)",
        target,
        int(b.version),
      ),
      stmt(
        db,
        "UPDATE item_requests SET status=?,decision_note=?,version=version+1,updated_at=? WHERE id=?",
        status,
        note,
        now,
        target,
      ),
      audit(db, m.id, "request_decided", target, { status, note }),
    ]);
    return { ok: true };
  }
  if (action === "removePost") {
    const kind = str(b.kind, 10),
      target = str(b.id, 80),
      reason = cleanText(b.reason, 500, 5);
    if (!["request", "review"].includes(kind)) fail("Choose a post.");
    const table = kind === "request" ? "item_requests" : "product_reviews",
      post = await first(db, "SELECT * FROM " + table + " WHERE id=?", target);
    if (!post) fail("Post not found.", 404);
    await atomic([
      guard(
        db,
        "EXISTS(SELECT 1 FROM " +
          table +
          " WHERE id=? AND version=? AND removed=0)",
        target,
        int(b.version),
      ),
      stmt(
        db,
        "UPDATE " +
          table +
          " SET removed=1,version=version+1,updated_at=? WHERE id=?",
        now,
        target,
      ),
      stmt(
        db,
        "UPDATE community_reports SET status='resolved' WHERE kind=? AND target=?",
        kind,
        target,
      ),
      audit(db, m.id, "community_post_removed", target, {
        kind,
        reason,
        before: post,
      }),
    ]);
    return { ok: true };
  }
  if (action === "resolveReport") {
    const target = str(b.id, 80),
      note = cleanText(b.note, 500, 5);
    await atomic([
      guard(
        db,
        "EXISTS(SELECT 1 FROM community_reports WHERE id=? AND status='open')",
        target,
      ),
      stmt(
        db,
        "UPDATE community_reports SET status='resolved' WHERE id=?",
        target,
      ),
      audit(db, m.id, "community_report_resolved", target, { note }),
    ]);
    return { ok: true };
  }
  if (action === "teamCreate") {
    const title = cleanText(b.title, 120, 3),
      body = cleanText(b.body, 4000, 1),
      kind = str(b.kind, 20);
    if (!["note", "question"].includes(kind))
      fail("Choose a team note or question.");
    await atomic([
      stmt(
        db,
        "INSERT INTO team_messages(id,actor,title,body,kind,pinned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        id,
        m.id,
        title,
        body,
        kind,
        b.pinned === true ? 1 : 0,
        now,
        now,
      ),
      audit(db, m.id, "team_message_created", id, { title, kind }),
    ]);
    return { ok: true };
  }
  if (action === "teamReply") {
    const target = str(b.id, 80),
      body = cleanText(b.body, 2000, 1);
    await atomic([
      guard(
        db,
        "EXISTS(SELECT 1 FROM team_messages WHERE id=? AND removed=0)",
        target,
      ),
      guard(
        db,
        "(SELECT COUNT(*) FROM team_replies WHERE message_id=?)<100",
        target,
      ),
      stmt(
        db,
        "INSERT INTO team_replies(id,message_id,actor,body,created_at) VALUES(?,?,?,?,?)",
        id,
        target,
        m.id,
        body,
        now,
      ),
      stmt(db, "UPDATE team_messages SET updated_at=? WHERE id=?", now, target),
    ]);
    return { ok: true };
  }
  if (action === "teamUpdate") {
    const target = str(b.id, 80),
      status = str(b.status, 20);
    if (!["open", "resolved"].includes(status))
      fail("Choose Open or Resolved.");
    await atomic([
      guard(
        db,
        "EXISTS(SELECT 1 FROM team_messages WHERE id=? AND version=? AND removed=0)",
        target,
        int(b.version),
      ),
      stmt(
        db,
        "UPDATE team_messages SET status=?,pinned=?,version=version+1,updated_at=? WHERE id=?",
        status,
        b.pinned === true ? 1 : 0,
        now,
        target,
      ),
      audit(db, m.id, "team_message_updated", target, {
        status,
        pinned: b.pinned === true,
      }),
    ]);
    return { ok: true };
  }
  fail("Unknown community action.");
}
