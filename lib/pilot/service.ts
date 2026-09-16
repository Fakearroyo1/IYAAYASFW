import { controls, TAB_REMINDER, TAB_HARD_LIMIT, ledger } from "./balances";
import {
  applyCredit,
  verifyPayment,
  correctTransaction,
  transactionDetail,
  correctionAmounts,
} from "./transactions";
import {
  historyPage,
  itemsForOrders,
  adminSummary,
  type HistoryOptions,
} from "./history";
import { catalog } from "./catalog";
import { OWNER_EMAIL } from "./owner";
import {
  type DB,
  type Row,
  PilotError,
  fail,
  int,
  str,
  uid,
  ownerAccount,
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
import { catalogState, extendedMutation } from "./products";
import { placeOrder } from "./orders";
export { PilotError } from "./core";
export async function initialize(db: DB) {
  if (await first(db, "SELECT id FROM settings WHERE id='main'")) return;
  await db.batch([
    stmt(db, "INSERT OR IGNORE INTO settings(id) VALUES('main')"),
    ...catalog.map((p, i) =>
      stmt(
        db,
        "INSERT OR IGNORE INTO products(id,name,category,detail,image,preorder,position) VALUES(?,?,?,?,?,?,?)",
        p.id,
        p.name,
        p.category,
        p.detail,
        p.image || null,
        p.preorder || 0,
        i,
      ),
    ),
    stmt(
      db,
      "INSERT OR IGNORE INTO members(id,email,name,role) VALUES(?,?,?,'admin')",
      "owner",
      OWNER_EMAIL,
      "Jake",
    ),
  ]);
}
export async function identity(
  db: DB,
  user: { userId: string; email: string } | null,
): Promise<Row | null> {
  if (!user) return null;
  let m = await first(db, "SELECT * FROM members WHERE user_id=?", user.userId);
  if (!m) {
    const invite = await first(
      db,
      "SELECT * FROM members WHERE email=? AND user_id IS NULL AND active=1",
      user.email.toLowerCase(),
    );
    if (invite) {
      await stmt(
        db,
        "UPDATE members SET user_id=? WHERE id=? AND user_id IS NULL",
        user.userId,
        invite.id,
      ).run();
      m = await first(db, "SELECT * FROM members WHERE user_id=?", user.userId);
    }
  }
  if (!m?.active) return null;
  const c = await controls(db, m.id);
  return {
    ...m,
    tab_limit: c.tab_limit,
    posting_enabled: c.posting_enabled,
    controls_version: c.version,
  };
}
export async function readState(
  db: DB,
  user: { userId: string; email: string } | null,
  options: HistoryOptions & {
    view?: string;
    section?: string;
    includeAdmin?: boolean;
  } = {},
) {
  await initialize(db);
  const m = await identity(db, user);
  if (!m) fail("Member access is required.", 403);
  const settings = await first(db, "SELECT * FROM settings WHERE id='main'");
  const includeAdmin = m.role === "admin" && options.includeAdmin === true,
    view = options.view || "account",
    section = options.section || "overview";
  const access =
      m.role === "admin"
        ? { snacks: 1, gear: 1 }
        : await accessFor(db, m as any),
    products = await catalogState(
      db,
      includeAdmin ? m : { ...m, role: "member" },
      access,
    );
  const result: Row = {
    settings: {
      ...settings,
      tabReminder: TAB_REMINDER,
      tabHardLimit: TAB_HARD_LIMIT,
    },
    products,
    member: { ...m, ...access, isOwner: ownerAccount(m) },
    signedIn: true,
    adminVerified: includeAdmin,
    adminLocked: m.role === "admin" && !includeAdmin,
    updatedAt: Date.now(),
    processor: { connected: false, provider: "none" },
    orders: [],
    payments: [],
    items: [],
    pages: {},
  };
  if (view !== "catalog") {
    const [orders, payments, pending] = await Promise.all([
      historyPage(db, m, "orders"),
      historyPage(db, m, "payments"),
      first(
        db,
        "SELECT COALESCE(SUM(amount),0) amount FROM payments WHERE member_id=? AND purpose='settlement' AND status='pending'",
        m.id,
      ),
    ]);
    if (view === "account") {
      const ledgerPage = await historyPage(db, m, "ledger");
      result.ledger = ledgerPage.records;
      result.pages.ledger = ledgerPage.nextCursor;
    }
    result.orders = orders.records;
    result.payments = payments.records;
    result.items = await itemsForOrders(db, orders.records);
    result.pendingSettlement = pending!.amount;
    result.pages = {
      ...result.pages,
      orders: orders.nextCursor,
      payments: payments.nextCursor,
    };
  }
  if (includeAdmin && view !== "catalog") {
    const a: Row = {
      orders: [],
      payments: [],
      members: [],
      items: [],
      events: [],
      expenses: [],
      resets: [],
      restocks: [],
      pages: {},
      summary: await adminSummary(db),
    };
    const orders = await historyPage(db, m, "orders", {
      admin: true,
      limit: section === "overview" ? 8 : 50,
    });
    a.orders = orders.records;
    a.pages.orders = orders.nextCursor;
    if (section === "payments") {
      const page = await historyPage(db, m, "payments", {
        ...options,
        admin: true,
      });
      a.payments = page.records;
      a.pages.payments = page.nextCursor;
    }
    if (section === "members") {
      const page = await historyPage(db, m, "members", {
        ...options,
        admin: true,
      });
      a.members = page.records;
      a.pages.members = page.nextCursor;
    }
    if (section === "activity") {
      const page = await historyPage(db, m, "events", { admin: true });
      a.events = page.records;
      a.pages.events = page.nextCursor;
    }
    const resets = await historyPage(db, m, "resets", { admin: true });
    a.resets = resets.records;
    a.pages.resets = resets.nextCursor;
    a.resetCount = (await first(
      db,
      "SELECT COUNT(*) n FROM password_reset_requests WHERE status='pending'",
    ))!.n;
    result.admin = a;
  }
  return result;
}
async function duplicate(
  db: DB,
  table: "orders" | "payments",
  id: string,
  fingerprint: string,
) {
  const existing = await first(db, `SELECT * FROM ${table} WHERE id=?`, id);
  if (existing && existing.fingerprint !== fingerprint)
    fail("This request identifier has already been used.", 409);
  return existing;
}
export async function mutate(
  db: DB,
  user: { userId: string; email: string; tokenHash?: string } | null,
  b: Row,
) {
  await initialize(db);
  const m = await identity(db, user);
  if (!m) fail("Member access is required.", 403);
  const actor = m.id;
  const admin = () => {
    if (m?.role !== "admin") fail("Administrator access is required.", 403);
  };
  const member = () => {
    if (!m) fail("Member access is required.", 403);
    return m!;
  };
  const settings = (await first(db, "SELECT * FROM settings WHERE id='main'"))!;
  const isAdminAction = !["order", "payment", "creditSettlement"].includes(
    b.action,
  );
  const operationId = isAdminAction ? reqId(b.requestId) : null;
  const operationFp = isAdminAction ? await hash({ actor, body: b }) : null;
  const atomic = async (db: DB, statements: D1PreparedStatement[]) =>
    batchAtomic(db, [
      ...sessionGuard(db, actor, user?.tokenHash, isAdminAction),
      ...(isAdminAction
        ? [
            guard(
              db,
              "EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND role='admin')",
              actor,
            ),
            ...statements,
            stmt(
              db,
              "INSERT INTO mutations(id,fingerprint) VALUES(?,?)",
              operationId,
              operationFp,
            ),
          ]
        : statements),
    ]);
  if (b.action === "order")
    return placeOrder(db, m, b, settings, user?.tokenHash);
  if (b.action === "creditSettlement") return applyCredit(db, m, b, atomic);
  if (b.action === "payment") {
    const who = member(),
      id = reqId(b.id),
      purpose = str(b.purpose, 20),
      method = str(b.method, 20),
      amount = int(b.amount, 1, 50000);
    if (
      !["settlement", "topup"].includes(purpose) ||
      !["cash", "cashapp"].includes(method)
    )
      fail("Invalid payment type.");
    if (method === "cashapp" && !settings.cashtag)
      fail("Cash App is not configured yet.");
    const fp = await hash({ actor, purpose, method, amount });
    const old = await duplicate(db, "payments", id, fp);
    if (old) return { payment: old, replayed: true };
    const pending = (await first(
      db,
      "SELECT COUNT(*) n FROM payments WHERE member_id=? AND order_id IS NULL AND status='pending'",
      actor,
    ))!.n;
    if (pending >= 5)
      fail(
        "You have five payment reports awaiting review. Ask an administrator to review them before reporting another payment.",
        429,
      );
    const statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM members WHERE id=? AND active=1) AND (SELECT COUNT(*) FROM payments WHERE member_id=? AND order_id IS NULL AND status='pending')<5",
        actor,
        actor,
      ),
    ];
    if (purpose === "settlement")
      statements.push(
        guard(
          db,
          "? <= (SELECT debt FROM members WHERE id=?) - COALESCE((SELECT SUM(amount) FROM payments WHERE member_id=? AND purpose='settlement' AND status='pending'),0)",
          amount,
          who.id,
          who.id,
        ),
      );
    statements.push(
      stmt(
        db,
        "INSERT INTO payments(id,fingerprint,member_id,purpose,method,amount,created_at) VALUES(?,?,?,?,?,?,?)",
        id,
        fp,
        who.id,
        purpose,
        method,
        amount,
        Date.now(),
      ),
      audit(db, actor, "payment_reported", id, { purpose, method, amount }),
    );
    try {
      await atomic(db, statements);
    } catch (e) {
      const old = await duplicate(db, "payments", id, fp);
      if (old) return { payment: old, replayed: true };
      throw e;
    }
    return {
      payment: await first(db, "SELECT * FROM payments WHERE id=?", id),
    };
  }
  admin();
  const previous = await first(
    db,
    "SELECT fingerprint FROM mutations WHERE id=?",
    operationId,
  );
  if (previous) {
    if (previous.fingerprint !== operationFp)
      fail("This action identifier was already used.", 409);
    return { ok: true, replayed: true };
  }
  if (b.action === "guestOrder")
    return placeOrder(db, m, b, settings, user?.tokenHash, true);
  if (b.action === "memberOrder") {
    const target = await first(
      db,
      "SELECT * FROM members WHERE id=? AND active=1",
      str(b.memberId, 80),
    );
    if (!target) fail("Choose an active member.", 404);
    if (str(b.reason || "", 300).length < 5)
      fail("Record the reason for this member purchase.");
    return placeOrder(db, target, b, settings, user?.tokenHash, false, m);
  }
  if (b.action === "correctTransaction")
    return correctTransaction(db, m, b, atomic);
  const extended = await extendedMutation(db, m, b, atomic);
  if (extended !== undefined) return extended;
  if (b.action === "shop") {
    if (
      typeof b.enabled !== "boolean" ||
      typeof b.previousEnabled !== "boolean"
    )
      fail("Choose whether to open or pause the shop.");
    if (
      b.enabled &&
      !(await first(
        db,
        "SELECT p.id FROM products p LEFT JOIN product_details d ON d.product_id=p.id WHERE p.active=1 AND COALESCE(d.archived,0)=0 AND p.tax_bp IS NOT NULL AND ((NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id) AND p.price>0 AND (p.preorder=1 OR p.stock>0)) OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1 AND COALESCE(v.price,p.price)>0 AND (v.preorder=1 OR v.stock>0))) LIMIT 1",
      ))
    )
      fail(
        "Make at least one priced product available with stock, or available for preorder.",
      );
    await atomic(db, [
      guard(
        db,
        "EXISTS(SELECT 1 FROM settings WHERE id='main' AND enabled=?)",
        b.previousEnabled ? 1 : 0,
      ),
      stmt(
        db,
        "UPDATE settings SET enabled=? WHERE id='main'",
        b.enabled ? 1 : 0,
      ),
      audit(
        db,
        actor,
        b.enabled ? "checkout_opened" : "checkout_paused",
        "main",
        { enabled: b.enabled },
      ),
    ]);
    return { ok: true };
  }
  if (b.action === "settings") {
    const cashtag = str(b.cashtag || "", 30).replace(/^\$/, "");
    if (cashtag && !/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(cashtag))
      fail("Enter the Cash App tag without spaces.");
    const enabled =
      b.enabled === undefined ? settings.enabled : b.enabled === true ? 1 : 0;
    if (
      b.enabled === true &&
      !settings.enabled &&
      !(await first(
        db,
        "SELECT p.id FROM products p LEFT JOIN product_details d ON d.product_id=p.id WHERE p.active=1 AND COALESCE(d.archived,0)=0 AND p.tax_bp IS NOT NULL AND ((NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id) AND p.price>0 AND (p.preorder=1 OR p.stock>0)) OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1 AND COALESCE(v.price,p.price)>0 AND (v.preorder=1 OR v.stock>0))) LIMIT 1",
      ))
    )
      fail("Configure at least one product before opening checkout.");
    await atomic(db, [
      stmt(
        db,
        "UPDATE settings SET enabled=CASE WHEN ? THEN enabled ELSE ? END,cashtag=?,cash_instructions=?,reminder_days=? WHERE id='main'",
        b.enabled === undefined ? 1 : 0,
        enabled,
        cashtag,
        str(b.cashInstructions, 400),
        int(b.reminderDays, 1, 90),
      ),
      audit(db, actor, "settings", "main", { enabled, cashtag }),
    ]);
    return { ok: true };
  }
  if (b.action === "product") {
    const id = b.id ? str(b.id, 80) : uid(),
      old = await first(db, "SELECT * FROM products WHERE id=?", id),
      name = str(b.name, 100),
      category = str(b.category, 20),
      detail = str(b.detail || "", 160),
      price =
        b.price === undefined
          ? (old?.price ?? null)
          : b.price === null
            ? null
            : int(b.price, 1, 100000),
      cost =
        b.cost === undefined
          ? (old?.cost ?? null)
          : b.cost === null
            ? null
            : int(b.cost),
      tax =
        b.taxBp === undefined
          ? (old?.tax_bp ?? null)
          : b.taxBp === null
            ? null
            : int(b.taxBp, 0, 3000),
      stock = int(b.stock, 0, 100000),
      reorder = int(b.reorder, 0, 10000),
      active = b.active === true ? 1 : 0,
      preorder = b.preorder === true ? 1 : 0,
      reason = str(b.reason || "", 200);
    if (
      price !== null &&
      category !== "Gear" &&
      b.price !== undefined &&
      price !== old?.price &&
      price % 25
    )
      fail("Snack prices must round up to a multiple of $0.25.");
    if (
      old?.category === "Gear" &&
      category !== "Gear" &&
      (await first(
        db,
        "SELECT id FROM product_variants WHERE product_id=? LIMIT 1",
        id,
      ))
    )
      fail("Products with gear options must remain in Gear.");
    if (!name || !["Drinks", "Snacks", "Frozen", "Gear"].includes(category))
      fail("Enter a product name and category.");
    if (active && (price === null || tax === null))
      fail(
        "Set a price and tax treatment before making this product available.",
      );
    if (preorder && category !== "Gear")
      fail("Preorders are only available for gear.");
    if (old && old.stock !== stock && !reason)
      fail("Give a reason for the stock adjustment.");
    const image =
      b.image === undefined
        ? old?.image || null
        : b.image === null
          ? null
          : str(b.image, 500);
    if (
      image &&
      !/^\/(?:products\/|api\/product-images\?id=)[a-zA-Z0-9_./?=\-]+$/.test(
        image,
      )
    )
      fail("Upload a valid product image.");
    const statements = [];
    if (old)
      statements.push(
        guard(
          db,
          "EXISTS(SELECT 1 FROM products WHERE id=? AND version=? AND stock=?)",
          id,
          int(b.version),
          int(b.previousStock),
        ),
      );
    statements.push(
      stmt(
        db,
        `INSERT INTO products(id,name,category,detail,image,price,cost,tax_bp,stock,reorder,active,preorder,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,detail=excluded.detail,image=excluded.image,price=excluded.price,cost=excluded.cost,tax_bp=excluded.tax_bp,stock=excluded.stock,reorder=excluded.reorder,active=excluded.active,preorder=excluded.preorder,version=products.version+1`,
        id,
        name,
        category,
        detail,
        image,
        price,
        cost,
        tax,
        stock,
        reorder,
        active,
        preorder,
        old?.position || 99,
      ),
      audit(db, actor, "product_updated", id, {
        before: old,
        after: {
          name,
          category,
          image,
          price,
          cost,
          tax,
          stock,
          reorder,
          active,
          preorder,
        },
        reason,
      }),
    );
    await atomic(db, statements);
    return { ok: true, productId: id };
  }
  if (b.action === "member") {
    const email = str(b.email, 200).toLowerCase(),
      name = str(b.name, 80);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name)
      fail("Enter a name and email address.");
    const old = await first(db, "SELECT * FROM members WHERE email=?", email),
      id = old?.id || uid(),
      debt = int(b.debt, 0, 100000),
      credit = int(b.credit, 0, 100000),
      limit = int(b.tabLimit, 0, TAB_HARD_LIMIT),
      reason = str(b.reason || "", 200),
      active = b.active !== false ? 1 : 0;
    if (b.id && (!old || old.id !== b.id))
      fail(
        "An existing member email cannot be changed. Refresh and edit the correct account.",
        409,
      );
    const role = b.role === undefined ? old?.role || "member" : str(b.role, 20),
      roleChanged = role !== (old?.role || "member");
    if (!["member", "admin"].includes(role))
      fail("Choose Member or Administrator.");
    if (old?.role === "admin" && !ownerAccount(m) && old.id !== actor)
      fail("Only the owner can manage another administrator.", 403);
    if (roleChanged && !ownerAccount(m))
      fail("Only the owner can change administrator access.", 403);
    if (old && ownerAccount(old) && (!active || role !== "admin"))
      fail("The owner account must stay active and remain an administrator.");
    if (roleChanged && role === "admin" && !active)
      fail("Enable member access before granting administrator access.");
    if ((debt !== (old?.debt || 0) || credit !== (old?.credit || 0)) && !reason)
      fail("Record the source or reason for the balance adjustment.");
    const access = await accessFor(db, { id, role }),
      snacks =
        b.snacks === undefined ? access.snacks : b.snacks === true ? 1 : 0,
      gear = b.gear === undefined ? access.gear : b.gear === true ? 1 : 0;
    const oldControls = await controls(db, id),
      posting =
        b.postingEnabled === undefined
          ? oldControls.posting_enabled
          : b.postingEnabled === true
            ? 1
            : 0;
    if (
      old &&
      b.controlsVersion !== undefined &&
      int(b.controlsVersion) !== oldControls.version
    )
      fail("Member controls changed. Review them again.", 409);
    const statements = [
      guard(
        db,
        "COALESCE((SELECT version FROM member_controls WHERE member_id=?),0)=?",
        id,
        oldControls.version,
      ),
    ];
    if (old)
      statements.push(
        guard(
          db,
          "COALESCE((SELECT snacks FROM member_access WHERE member_id=?),1)=? AND COALESCE((SELECT gear FROM member_access WHERE member_id=?),1)=?",
          id,
          access.snacks,
          id,
          access.gear,
        ),
      );
    if (
      !active ||
      roleChanged ||
      snacks !== access.snacks ||
      gear !== access.gear
    )
      statements.push(
        stmt(db, "DELETE FROM auth_sessions WHERE member_id=?", id),
      );
    if (old)
      statements.push(
        guard(
          db,
          "EXISTS(SELECT 1 FROM members WHERE id=? AND debt=? AND credit=? AND role=? AND active=?)",
          id,
          int(b.previousDebt),
          int(b.previousCredit),
          b.previousRole === undefined ? old.role : str(b.previousRole, 20),
          old.active,
        ),
      );
    statements.push(
      guard(
        db,
        "? >= COALESCE((SELECT SUM(amount) FROM payments WHERE member_id=? AND purpose='settlement' AND status='pending'),0)",
        debt,
        id,
      ),
    );
    statements.push(
      stmt(
        db,
        `INSERT INTO members(id,email,name,role,debt,credit,tab_limit,due_since,active) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role,debt=excluded.debt,credit=excluded.credit,tab_limit=excluded.tab_limit,due_since=excluded.due_since,active=excluded.active`,
        id,
        email,
        name,
        role,
        debt,
        credit,
        limit,
        debt ? old?.due_since || Date.now() : null,
        active,
      ),
      audit(db, actor, "member_updated", id, {
        before: old,
        after: { name, email, role, debt, credit, limit, active },
        reason,
      }),
    );
    statements.push(
      stmt(
        db,
        "INSERT INTO member_access(member_id,snacks,gear) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET snacks=excluded.snacks,gear=excluded.gear",
        id,
        snacks,
        gear,
      ),
    );
    statements.push(
      stmt(
        db,
        "INSERT INTO member_controls(member_id,tab_limit,posting_enabled) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET tab_limit=excluded.tab_limit,posting_enabled=excluded.posting_enabled,version=member_controls.version+1",
        id,
        limit,
        posting,
      ),
    );
    if (posting !== oldControls.posting_enabled)
      statements.push(
        audit(db, actor, "community_posting_changed", id, {
          enabled: !!posting,
          reason: reason || "Member access updated.",
        }),
      );
    if (debt !== (old?.debt || 0) || credit !== (old?.credit || 0))
      statements.push(
        ledger(
          db,
          id,
          actor,
          "admin_adjustment",
          debt - (old?.debt || 0),
          credit - (old?.credit || 0),
          reason,
        ),
      );
    if (snacks !== access.snacks || gear !== access.gear)
      statements.push(
        audit(db, actor, "purchasing_access_updated", id, {
          before: access,
          after: { snacks, gear },
        }),
      );
    await atomic(db, statements);
    return { ok: true, memberId: id, created: !old, roleChanged };
  }
  if (b.action === "verify") return verifyPayment(db, m, b, atomic);
  if (b.action === "reject") {
    const p = await first(
        db,
        "SELECT * FROM payment_balances WHERE id=?",
        str(b.id, 40),
      ),
      reason = str(b.reason, 200);
    if (!p || p.status !== "pending" || !reason)
      fail("Choose a pending payment and give a reason.");
    if (p.order_id) {
      if (b.returned !== true)
        fail("Use transaction corrections to review goods already taken.");
      const detail = await transactionDetail(db, p.order_id),
        selected = detail.items
          .filter((i) => i.remaining_qty > 0)
          .map((i) => ({
            id: i.id,
            qty: i.remaining_qty,
            restock: !i.preorder && !i.custom,
          }));
      const a = correctionAmounts(
        detail.order,
        detail.items,
        selected,
        detail.member,
        p.amount,
      );
      return correctTransaction(
        db,
        m,
        {
          ...b,
          id: p.order_id,
          revision: detail.order.revision,
          items: selected,
          refundMethod: "credit",
          confirmed: true,
          expectedTotal: a.total,
          expectedDebtReduction: a.debtReduced,
          expectedReturn: a.toReturn,
        },
        atomic,
      );
    }
    await atomic(db, [
      guard(
        db,
        "EXISTS(SELECT 1 FROM payments WHERE id=? AND status='pending')",
        p.id,
      ),
      stmt(db, "UPDATE payments SET status='rejected' WHERE id=?", p.id),
      audit(db, actor, "payment_rejected", p.id, { reason }),
    ]);
    return { ok: true };
  }
  if (b.action === "expense" || b.action === "cashcount") {
    const description = str(b.description, 200),
      amount = int(b.amount, 0, 10000000);
    if (!description) fail("Enter a description or counter names.");
    const statements = [
      audit(db, actor, b.action, "fund", { amount, description }),
    ];
    if (b.action === "expense")
      statements.push(
        stmt(
          db,
          "INSERT INTO expenses(id,kind,amount,description,created_at) VALUES(?,?,?,?,?)",
          uid(),
          "morale",
          amount,
          description,
          Date.now(),
        ),
      );
    await atomic(db, statements);
    return { ok: true };
  }
  fail("Unknown action.");
}
