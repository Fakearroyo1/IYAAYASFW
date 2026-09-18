import { type DB, type Row, fail, str, int, first, rows, stmt, guard, audit, uid } from "./core";
import { operation, noteText } from "./operation";
import { ledger } from "./balances";
import { rewardCreditGrant } from "./earning";

export const REDEMPTION_MEMBER_ACTIONS = ["rewardRedeem"];
export const REDEMPTION_ADMIN_ACTIONS = ["redemptionRewardSave", "raffleSave", "raffleEntryAdd", "raffleDraw", "raffleExternalResult"];
const walletSQL = "COALESCE((SELECT SUM(amount) FROM reward_ledger WHERE member_id=?),0)-COALESCE((SELECT SUM(points) FROM reward_redemptions WHERE member_id=?),0)";

export async function rewardWallet(db: DB, memberId: string) {
  const balance = (await first(db, `SELECT COALESCE((SELECT SUM(amount) FROM reward_ledger WHERE member_id=?),0) earned,
    COALESCE((SELECT SUM(points) FROM reward_redemptions WHERE member_id=?),0) spent,
    COALESCE((SELECT frozen FROM reward_members WHERE member_id=?),0) frozen`, memberId, memberId, memberId))!;
  const earned = Number(balance.earned), spent = Number(balance.spent);
  return { earned, spent, available: earned - spent, frozen: Boolean(balance.frozen) };
}

export async function redemptionPage(db: DB, m: Row, q: Row, admin = false) {
  if (admin && m.role !== "admin") fail("Verified administrator access is required.", 403);
  const now = Date.now();
  const catalog = await rows(db, `SELECT c.* FROM redemption_rewards c LEFT JOIN reward_raffles r ON r.id=c.raffle_id
    WHERE ?=1 OR (c.active=1 AND (c.kind='credit' OR (r.active=1 AND r.status='open' AND r.starts_at<=? AND r.ends_at>?))) ORDER BY c.kind,c.name,c.id`, admin ? 1 : 0, now, now);
  const raffles = await rows(db, `SELECT r.*,d.winning_ticket,d.drawn_at,e.member_id winner_member_id,e.visitor_name winner_visitor_name,
    m.name winner_member_name,m.active winner_active,pc.alias winner_alias,p.visible winner_visible,p.moderation winner_moderation
    FROM reward_raffles r LEFT JOIN raffle_draws d ON d.raffle_id=r.id LEFT JOIN raffle_entries e ON e.id=d.entry_id
    LEFT JOIN members m ON m.id=e.member_id LEFT JOIN member_profiles p ON p.member_id=e.member_id LEFT JOIN profile_approved_content pc ON pc.member_id=p.member_id
    WHERE ?=1 OR r.active=1 ORDER BY r.starts_at DESC LIMIT 100`, admin ? 1 : 0);
  const raffleId = q.raffleId ? str(q.raffleId, 80) : "";
  const entryOffset = int(Number(q.entryOffset || 0), 0, 100000);
  const entries = await rows(db, `SELECT e.*,r.name raffle_name,m.name member_name FROM raffle_entries e JOIN reward_raffles r ON r.id=e.raffle_id LEFT JOIN members m ON m.id=e.member_id
    WHERE (?=1 OR e.member_id=?) AND (?='' OR e.raffle_id=?) ORDER BY e.created_at DESC,e.ticket_start DESC LIMIT 1001 OFFSET ?`, admin ? 1 : 0, m.id, raffleId, raffleId, entryOffset);
  const historyOffset = int(Number(q.offset || 0), 0, 100000);
  const redemptions = await rows(db, `SELECT x.*,x.points points_spent,'issued' status,m.name member_name FROM reward_redemptions x JOIN members m ON m.id=x.member_id
    WHERE ?=1 OR x.member_id=? ORDER BY x.created_at DESC,x.id DESC LIMIT 101 OFFSET ?`, admin ? 1 : 0, m.id, historyOffset);
  return {
    wallet: await rewardWallet(db, m.id), catalog,
    raffles: raffles.map((r) => ({ id: r.id, name: r.name, description: r.description, mode: r.mode, active: r.active,
      starts_at: r.starts_at, ends_at: r.ends_at, status: r.status, ticket_count: r.ticket_count, version: r.version,
      winner: r.winning_ticket == null ? null : { ticket: r.winning_ticket, drawn_at: r.drawn_at,
        display_name: admin ? (r.winner_member_name || r.winner_visitor_name) : r.winner_member_id === m.id ? "You" : r.winner_active && r.winner_visible && r.winner_moderation !== "hidden" && r.winner_alias ? r.winner_alias : "Event participant",
        ...(admin ? { member_id: r.winner_member_id } : {}) } })),
    entries: entries.slice(0, 1000).map((e) => admin ? { ...e, name: e.member_name || e.visitor_name } : {
      id: e.id, raffle_id: e.raffle_id, raffle_name: e.raffle_name, ticket_start: e.ticket_start, ticket_end: e.ticket_end,
      quantity: e.quantity, redemption_id: e.redemption_id, created_at: e.created_at,
    }), entriesMore: entries.length > 1000,
    redemptions: redemptions.slice(0, 100), more: redemptions.length > 100,
    ...(admin ? { members: await rows(db, "SELECT id,name,active FROM members ORDER BY name") } : {}),
  };
}

function raffleGuard(db: DB, raffle: Row, quantity: number, now: number) {
  return guard(db, "EXISTS(SELECT 1 FROM reward_raffles WHERE id=? AND version=? AND active=1 AND status='open' AND starts_at<=? AND ends_at>? AND ticket_count=? AND ticket_count+?<=100000)",
    raffle.id, raffle.version, now, now, raffle.ticket_count, quantity);
}

function entryStatements(db: DB, raffle: Row, memberId: string | null, visitorName: string | null, quantity: number, actor: string, entryId: string, now: number, redemptionId: string | null = null) {
  return [
    raffleGuard(db, raffle, quantity, now),
    ...(memberId ? [guard(db, "EXISTS(SELECT 1 FROM members WHERE id=? AND active=1)", memberId)] : []),
    stmt(db, "INSERT INTO raffle_entries(id,raffle_id,member_id,visitor_name,quantity,ticket_start,ticket_end,redemption_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      entryId, raffle.id, memberId, visitorName, quantity, raffle.ticket_count + 1, raffle.ticket_count + quantity, redemptionId, actor, now),
    stmt(db, "UPDATE reward_raffles SET ticket_count=ticket_count+?,version=version+1,updated_at=? WHERE id=?", quantity, now, raffle.id),
  ];
}

// Rejection sampling avoids modulo bias. Draw once, then commit against the exact ticket snapshot.
export function randomTicket(ticketCount: number) {
  int(ticketCount, 1, 100000);
  const range = 0x100000000, ceiling = range - range % ticketCount, value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= ceiling);
  return value[0] % ticketCount + 1;
}

export async function mutateRedemptions(db: DB, m: Row, b: Row, tokenHash?: string) {
  const admin = REDEMPTION_ADMIN_ACTIONS.includes(b.action);
  if (!admin && !REDEMPTION_MEMBER_ACTIONS.includes(b.action)) fail("Unknown rewards action.");
  const op = await operation(db, m, b, admin, tokenHash);
  if (op.replayed) return { ok: true, replayed: true, redemption: await first(db, "SELECT * FROM reward_redemptions WHERE id=? AND member_id=?", op.id, m.id),
    draw: await first(db, "SELECT * FROM raffle_draws WHERE request_id=?", op.id) };
  const now = Date.now();
  let statements: D1PreparedStatement[] = [], result: Row = { ok: true };
  if (b.action === "redemptionRewardSave") {
    const id = b.id ? str(b.id, 80) : uid(), old = await first(db, "SELECT * FROM redemption_rewards WHERE id=?", id);
    if (old && int(b.version) !== old.version) fail("This reward changed. Refresh before saving.", 409);
    const name = noteText(b.name, 100, 2), description = noteText(b.description || "", 1200, 0), kind = str(b.kind, 10);
    if (!["credit", "raffle"].includes(kind)) fail("Choose store credit or raffle tickets.");
    const points = int(b.points, 1, 100000), credit = kind === "credit" ? int(b.creditCents, 1, 50000) : 0,
      ticketQuantity = kind === "raffle" ? int(b.ticketQuantity, 1, 100) : 0,
      raffleId = kind === "raffle" ? str(b.raffleId, 80) : null,
      stockLimit = b.stockLimit == null || b.stockLimit === "" ? null : int(b.stockLimit, 0, 100000);
    if (old && old.issued_count && (kind !== old.kind || raffleId !== old.raffle_id)) fail("Create a new reward to change its type or raffle after redemptions.");
    if (old && stockLimit != null && stockLimit < old.issued_count) fail("The reward limit cannot be lower than rewards already issued.");
    const financialChange = old && old.issued_count && (old.points !== points || old.credit_cents !== credit || old.ticket_quantity !== ticketQuantity);
    const reason = financialChange ? noteText(b.reason || "") : noteText(b.reason || "", 1000, 0);
    statements.push(old ? guard(db, "EXISTS(SELECT 1 FROM redemption_rewards WHERE id=? AND version=? AND issued_count=?)", id, old.version, old.issued_count) : guard(db, "NOT EXISTS(SELECT 1 FROM redemption_rewards WHERE id=?)", id));
    if (raffleId) statements.push(guard(db, "EXISTS(SELECT 1 FROM reward_raffles WHERE id=?)", raffleId));
    if (old) statements.push(stmt(db, "UPDATE redemption_rewards SET name=?,description=?,kind=?,points=?,credit_cents=?,ticket_quantity=?,raffle_id=?,active=?,stock_limit=?,version=version+1,updated_at=? WHERE id=?",
      name, description, kind, points, credit, ticketQuantity, raffleId, b.active === true ? 1 : 0, stockLimit, now, id));
    else statements.push(stmt(db, "INSERT INTO redemption_rewards(id,name,description,kind,points,credit_cents,ticket_quantity,raffle_id,active,stock_limit,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, name, description, kind, points, credit, ticketQuantity, raffleId, b.active === true ? 1 : 0, stockLimit, m.id, now, now));
    statements.push(audit(db, m.id, "redemption_reward_saved", id, { name, kind, points, creditCents: credit, ticketQuantity, raffleId, active: b.active === true, stockLimit, reason }));
    result.id = id;
  } else if (b.action === "rewardRedeem") {
    const reward = await first(db, "SELECT * FROM redemption_rewards WHERE id=?", str(b.rewardId, 80));
    if (!reward || !reward.active) fail("This reward is not currently available.", 409);
    if (int(b.version) !== reward.version) fail("This reward changed. Refresh before redeeming.", 409);
    const quantity = int(b.quantity ?? 1, 1, 10), points = reward.points * quantity, credit = reward.credit_cents * quantity,
      ticketQuantity = reward.ticket_quantity * quantity;
    if (reward.stock_limit != null && reward.issued_count + quantity > reward.stock_limit) fail("There are not enough rewards remaining.", 409);
    const wallet = await rewardWallet(db, m.id);
    if (wallet.frozen) fail("Murley Bucks redemptions are paused for this account. Contact an administrator.", 403);
    if (wallet.available < points) fail("You do not have enough available Murley Bucks.", 409);
    statements.push(
      guard(db, "EXISTS(SELECT 1 FROM redemption_rewards WHERE id=? AND version=? AND active=1 AND (stock_limit IS NULL OR issued_count+?<=stock_limit))", reward.id, reward.version, quantity),
      guard(db, `${walletSQL}>=? AND COALESCE((SELECT frozen FROM reward_members WHERE member_id=?),0)=0`, m.id, m.id, points, m.id),
      stmt(db, "INSERT INTO reward_redemptions(id,member_id,reward_id,reward_name,kind,quantity,points,credit_cents,raffle_id,ticket_quantity,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        op.id, m.id, reward.id, reward.name, reward.kind, quantity, points, credit, reward.raffle_id, ticketQuantity, now),
      stmt(db, "UPDATE redemption_rewards SET issued_count=issued_count+? WHERE id=?", quantity, reward.id),
    );
    if (reward.kind === "credit") {
      statements.push(stmt(db, "UPDATE members SET credit=credit+? WHERE id=?", credit, m.id),
        ...rewardCreditGrant(db, m.id, credit, "redemption:" + op.id),
        ledger(db, m.id, m.id, "reward_credit", 0, credit, `Redeemed ${points} Murley Bucks: ${reward.name}.`));
    } else {
      const raffle = await first(db, "SELECT * FROM reward_raffles WHERE id=?", reward.raffle_id);
      if (!raffle || !raffle.active || raffle.status !== "open" || raffle.starts_at > now || raffle.ends_at <= now) fail("This raffle is not accepting entries.", 409);
      statements.push(...entryStatements(db, raffle, m.id, null, ticketQuantity, m.id, op.id, now, op.id));
    }
    statements.push(audit(db, m.id, "murley_bucks_redeemed", op.id, { rewardId: reward.id, quantity, points, creditCents: credit, raffleId: reward.raffle_id, ticketQuantity }));
    result.redemptionId = op.id;
  } else if (b.action === "raffleSave") {
    const id = b.id ? str(b.id, 80) : uid(), old = await first(db, "SELECT * FROM reward_raffles WHERE id=?", id),
      name = noteText(b.name, 100, 2), description = noteText(b.description || "", 1500, 0), mode = str(b.mode, 20),
      start = int(b.startsAt, 0, 9999999999999), end = int(b.endsAt, 0, 9999999999999);
    if (old && int(b.version) !== old.version) fail("This raffle changed. Refresh before saving.", 409);
    if (!["internal", "external"].includes(mode)) fail("Choose a website or outside draw.");
    if (end <= start || end - start > 366 * 86400000) fail("Choose a raffle window of at most one year.");
    if (old && old.ticket_count && (old.mode !== mode || old.starts_at !== start || old.ends_at !== end)) fail("The drawing method and entry window are fixed once tickets are issued.");
    statements.push(old ? guard(db, "EXISTS(SELECT 1 FROM reward_raffles WHERE id=? AND version=?)", id, old.version) : guard(db, "NOT EXISTS(SELECT 1 FROM reward_raffles WHERE id=?)", id));
    if (old) statements.push(stmt(db, "UPDATE reward_raffles SET name=?,description=?,mode=?,active=?,starts_at=?,ends_at=?,version=version+1,updated_at=? WHERE id=?", name, description, mode, b.active === true ? 1 : 0, start, end, now, id));
    else statements.push(stmt(db, "INSERT INTO reward_raffles(id,name,description,mode,active,starts_at,ends_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", id, name, description, mode, b.active === true ? 1 : 0, start, end, m.id, now, now));
    statements.push(audit(db, m.id, "raffle_saved", id, { name, mode, active: b.active === true, startsAt: start, endsAt: end }));
    result.id = id;
  } else if (b.action === "raffleEntryAdd") {
    const raffle = await first(db, "SELECT * FROM reward_raffles WHERE id=?", str(b.raffleId, 80));
    if (!raffle) fail("Raffle not found.", 404);
    if (raffle.version !== int(b.version)) fail("The raffle changed. Refresh before adding entries.", 409);
    const memberId = b.memberId ? str(b.memberId, 80) : null, visitorName = memberId ? null : noteText(b.visitorName, 100, 2), quantity = int(b.quantity, 1, 1000);
    if (memberId && b.visitorName) fail("Choose a member or a visitor, not both.");
    statements.push(...entryStatements(db, raffle, memberId, visitorName, quantity, m.id, op.id, now),
      audit(db, m.id, "raffle_free_entries_added", op.id, { raffleId: raffle.id, memberId, visitor: !memberId, quantity }));
    result.entryId = op.id;
  } else {
    const raffle = await first(db, "SELECT * FROM reward_raffles WHERE id=?", str(b.raffleId, 80));
    if (!raffle) fail("Raffle not found.", 404);
    if (raffle.status !== "open") fail("This raffle already has a final result.", 409);
    if (raffle.version !== int(b.version)) fail("Entries changed. Refresh before drawing.", 409);
    if (!raffle.ticket_count) fail("Add at least one entry before drawing.");
    if (b.confirmed !== true) fail("Confirm that this will close entries and record one final winner.");
    const external = b.action === "raffleExternalResult";
    if ((external ? "external" : "internal") !== raffle.mode) fail("Use the raffle's configured drawing method.");
    if (external && raffle.active && raffle.ends_at > now)
      fail("Pause entries before exporting the final ticket list and recording an outside draw.", 409);
    const season = await first(db, "SELECT * FROM reward_seasons WHERE starts_at<=? AND ends_at>? AND archived_at IS NULL ORDER BY starts_at DESC LIMIT 1", now, now);
    // Validate before random selection so a missing season can never cause only
    // member-winning results to fail while a visitor-winning retry succeeds.
    if (!season && await first(db, "SELECT 1 FROM raffle_entries WHERE raffle_id=? AND member_id IS NOT NULL LIMIT 1", raffle.id))
      fail("Create a current recognition season before drawing so the winner receives their seasonal badge.", 409);
    const ticket = external ? int(b.winningTicket, 1, raffle.ticket_count) : randomTicket(raffle.ticket_count),
      reason = external ? noteText(b.reason) : noteText(b.reason || "", 1000, 0),
      winner = await first(db, "SELECT * FROM raffle_entries WHERE raffle_id=? AND ticket_start<=? AND ticket_end>=?", raffle.id, ticket, ticket);
    if (!winner) fail("The selected ticket was not issued.", 409);
    statements.push(
      guard(db, "EXISTS(SELECT 1 FROM reward_raffles WHERE id=? AND version=? AND status='open' AND ticket_count=?) AND NOT EXISTS(SELECT 1 FROM raffle_draws WHERE raffle_id=?)", raffle.id, raffle.version, raffle.ticket_count, raffle.id),
      ...(external ? [guard(db, "EXISTS(SELECT 1 FROM reward_raffles WHERE id=? AND (active=0 OR ends_at<=?))", raffle.id, now)] : []),
      stmt(db, "INSERT INTO raffle_draws(raffle_id,entry_id,winning_ticket,eligible_tickets,method,request_id,drawn_by,drawn_at,season_id,reason) VALUES(?,?,?,?,?,?,?,?,?,?)", raffle.id, winner.id, ticket, raffle.ticket_count, raffle.mode, op.id, m.id, now, season?.id || null, reason),
      stmt(db, "UPDATE reward_raffles SET status='drawn',version=version+1,updated_at=? WHERE id=?", now, raffle.id),
    );
    if (winner.member_id && season) {
      const badgeId = "raffle-winner:" + season.id;
      statements.push(
        guard(db, "EXISTS(SELECT 1 FROM reward_seasons WHERE id=? AND version=? AND starts_at<=? AND ends_at>? AND archived_at IS NULL)", season.id, season.version, now, now),
        stmt(db, "INSERT OR IGNORE INTO badge_definitions(id,name,description,criteria,category,rarity,color,symbol) VALUES(?,'Raffle Winner',?,'Winner of a unit raffle during this recognition season.','Season winner','Seasonal','orange','medal')", badgeId, "Won a unit raffle during " + season.name + "."),
        stmt(db, "INSERT OR IGNORE INTO badge_awards(id,badge_id,member_id,issuer,reason,issued_at,expires_at) VALUES(?,?,?,?,?,?,?)", badgeId + ":" + winner.member_id, badgeId, winner.member_id, m.id, "Winner of " + raffle.name + ", ticket " + ticket + ".", now, season.ends_at),
      );
    }
    statements.push(audit(db, m.id, "raffle_draw_recorded", raffle.id, { method: raffle.mode, winningTicket: ticket, entryId: winner.id, eligibleTickets: raffle.ticket_count, seasonId: season?.id || null, reason }));
    result.winningTicket = ticket;
  }
  await op.commit(statements);
  if (b.action === "rewardRedeem") result.redemption = await first(db, "SELECT * FROM reward_redemptions WHERE id=?", op.id);
  if (b.action === "raffleDraw" || b.action === "raffleExternalResult") {
    result.draw = await first(db, "SELECT * FROM raffle_draws WHERE raffle_id=?", b.raffleId);
    result.winningTicket = result.draw?.winning_ticket;
  }
  return result;
}
