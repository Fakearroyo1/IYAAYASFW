import {
  type DB,
  type Row,
  fail,
  str,
  int,
  first,
  rows,
  stmt,
  guard,
  audit,
  uid,
} from "./core";
import { operation, noteText } from "./operation";
export const REWARD_ADMIN_ACTIONS = [
  "rewardRule",
  "rewardSettings",
  "rewardAward",
  "rewardReverse",
  "rewardFreeze",
  "rewardRepair",
  "badgeSave",
  "badgeIssue",
  "badgeRevoke",
  "profileModerate",
  "profileResolve",
  "seasonCreate",
  "seasonArchive",
];
export const PROFILE_ACTIONS = ["profileSave", "profileReport"];
export const ACCENTS = ["blue", "indigo", "green", "orange", "rose", "slate"];
export const SYMBOLS = ["star", "shield", "hands", "compass", "medal", "flag"];
export const THEMES = ["classic", "gradient", "outlined"];
export async function rewardTotal(db: DB, memberId: string) {
  return (
    (
      await first(
        db,
        "SELECT COALESCE(SUM(amount),0) total FROM reward_ledger WHERE member_id=?",
        memberId,
      )
    )?.total || 0
  );
}
export function unlockedTier(settings: Row, total: number) {
  const tiers = JSON.parse(settings.tiers);
  return (
    [...tiers].reverse().find((t: Row) => total >= t.threshold) || tiers[0]
  );
}
export async function earnedBadges(db: DB, memberId: string) {
  return rows(
    db,
    `SELECT a.id award_id,a.badge_id,a.reason,a.issued_at,a.expires_at,d.name,d.description,d.criteria,d.category,d.rarity,d.color,d.symbol FROM badge_awards a JOIN badge_definitions d ON d.id=a.badge_id WHERE a.member_id=? AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>?) AND d.active=1 ORDER BY a.issued_at DESC`,
    memberId,
    Date.now(),
  );
}
async function profileView(db: DB, p: Row, settings: Row) {
  const total = await rewardTotal(db, p.member_id),
    tier = unlockedTier(settings, total),
    badges = await earnedBadges(db, p.member_id),
    selected = JSON.parse(p.display_badges);
  return {
    id: p.public_id,
    alias: p.alias,
    bio: tier.bio ? p.bio : "",
    accent: tier.accent ? p.accent : "blue",
    theme: tier.theme ? p.theme : "classic",
    avatar: tier.avatar ? p.avatar_id : null,
    banner: tier.banner ? p.banner_id : null,
    tier: tier.name,
    badges: badges
      .filter((b) => selected.includes(b.award_id))
      .slice(0, tier.slots),
  };
}
export async function rewardsPage(db: DB, m: Row, q: Row, admin = false) {
  const settings = (await first(
    db,
    "SELECT * FROM reward_settings WHERE id='main'",
  ))!;
  if (q.kind === "profile") {
    const p = await first(
      db,
      "SELECT p.* FROM member_profiles p JOIN members m ON m.id=p.member_id WHERE p.public_id=? AND p.visible=1 AND p.moderation='approved' AND m.active=1",
      str(q.id, 80),
    );
    if (!p) fail("Profile unavailable.", 404);
    return { profile: await profileView(db, p, settings) };
  }
  const memberId = admin && q.memberId ? str(q.memberId, 80) : m.id,
    total = await rewardTotal(db, memberId),
    tier = unlockedTier(settings, total);
  const profile = await first(
      db,
      "SELECT * FROM member_profiles WHERE member_id=?",
      memberId,
    ),
    control = await first(
      db,
      "SELECT * FROM reward_members WHERE member_id=?",
      memberId,
    );
  const ledger = await rows(
    db,
    "SELECT id,amount,rule_id,source,note,created_at,actor,reverses FROM reward_ledger WHERE member_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
    memberId,
    int(Number(q.offset || 0), 0, 100000),
  );
  const rules = await rows(db, "SELECT * FROM reward_rules ORDER BY id"),
    badges = await earnedBadges(db, memberId),
    seasons = await rows(
      db,
      "SELECT * FROM reward_seasons ORDER BY starts_at DESC LIMIT 24",
    );
  const now = Date.now(),
    current = seasons.find(
      (s) => s.starts_at <= now && s.ends_at > now && !s.archived_at,
    ),
    season =
      q.season && q.season !== "all"
        ? seasons.find((s) => s.id === q.season)
        : q.season === "all"
          ? null
          : current;
  if (q.season && q.season !== "all" && !season) fail("Season not found.", 404);
  const candidates = season?.archived_at
    ? await rows(
        db,
        `SELECT p.*,r.points,r.place FROM reward_season_results r JOIN member_profiles p ON p.member_id=r.member_id JOIN members m ON m.id=p.member_id WHERE r.season_id=? AND m.active=1 AND p.visible=1 AND p.board_opt_in=1 AND p.moderation='approved' ORDER BY r.place,p.public_id LIMIT 100`,
        season.id,
      )
    : await rows(
        db,
        `SELECT p.*,COALESCE(SUM(l.amount),0) points FROM member_profiles p JOIN members m ON m.id=p.member_id LEFT JOIN reward_ledger l ON l.member_id=p.member_id AND l.created_at>=? AND l.created_at<? WHERE m.active=1 AND p.visible=1 AND p.board_opt_in=1 AND p.moderation='approved' GROUP BY p.member_id HAVING COALESCE(SUM(l.amount),0)>0 ORDER BY points DESC,p.public_id LIMIT 100`,
        season?.starts_at || 0,
        season?.ends_at || 9999999999999,
      );
  const titles = JSON.parse(settings.titles);
  let place = 0,
    prior: number | null = null;
  const board = candidates.map((p, i) => {
    if (p.points !== prior) place = i + 1;
    prior = p.points;
    const rank = p.place || place;
    return {
      id: p.public_id,
      alias: p.alias,
      points: p.points,
      place: rank,
      title: titles[rank - 1] || "Unit Supporter",
    };
  });
  const result: Row = {
    total,
    tier,
    settings: { ...settings, tiers: JSON.parse(settings.tiers), titles },
    profile,
    control: control || { frozen: 0, version: -1 },
    ledger: ledger.slice(0, 50),
    more: ledger.length > 50,
    rules,
    badges,
    board,
    seasons,
    season: season?.id || "all",
    memberId,
  };
  if (admin) {
    result.members = await rows(
      db,
      "SELECT id,name,active FROM members ORDER BY name",
    );
    result.definitions = await rows(
      db,
      "SELECT * FROM badge_definitions ORDER BY name",
    );
    result.badgeHistory = await rows(
      db,
      "SELECT a.*,d.name FROM badge_awards a JOIN badge_definitions d ON d.id=a.badge_id WHERE a.member_id=? ORDER BY a.issued_at DESC LIMIT 100",
      memberId,
    );
    result.profiles = await rows(
      db,
      "SELECT p.*,m.name member_name FROM member_profiles p JOIN members m ON m.id=p.member_id ORDER BY p.updated_at DESC LIMIT 100",
    );
    result.reports = await rows(
      db,
      "SELECT r.*,p.alias FROM profile_reports r JOIN member_profiles p ON p.public_id=r.profile_id WHERE r.status='open' ORDER BY r.created_at LIMIT 100",
    );
  }
  return result;
}
export async function mutateRewards(
  db: DB,
  m: Row,
  b: Row,
  tokenHash?: string,
) {
  const admin = REWARD_ADMIN_ACTIONS.includes(b.action),
    op = await operation(db, m, b, admin, tokenHash);
  if (op.replayed) return { ok: true, replayed: true };
  const now = Date.now();
  let statements: D1PreparedStatement[] = [],
    result: Row = { ok: true };
  const settings = (await first(
    db,
    "SELECT * FROM reward_settings WHERE id='main'",
  ))!;
  if (b.action === "profileSave") {
    const old = await first(
        db,
        "SELECT * FROM member_profiles WHERE member_id=?",
        m.id,
      ),
      total = await rewardTotal(db, m.id),
      tier = unlockedTier(settings, total),
      alias = noteText(b.alias, 40, 2),
      bio = str(b.bio || "", 240),
      accent = str(b.accent || "blue", 20),
      theme = str(b.theme || "classic", 20),
      avatar = b.avatarId ? str(b.avatarId, 80) : null,
      banner = b.bannerId ? str(b.bannerId, 80) : null;
    if (!ACCENTS.includes(accent) || !THEMES.includes(theme))
      fail("Choose an available profile treatment.");
    if (
      (!tier.bio && bio) ||
      (!tier.accent && accent !== "blue") ||
      (!tier.theme && theme !== "classic") ||
      (!tier.avatar && avatar) ||
      (!tier.banner && banner)
    )
      fail("This customization has not unlocked yet.");
    if (
      !Array.isArray(b.badges) ||
      b.badges.length > tier.slots ||
      new Set(b.badges).size !== b.badges.length
    )
      fail("Choose badges within your unlocked slots.");
    const earned = await earnedBadges(db, m.id);
    if (b.badges.some((id: string) => !earned.some((e) => e.award_id === id)))
      fail("Choose currently earned badges.");
    const changed =
      !old ||
      old.alias !== alias ||
      old.bio !== bio ||
      old.avatar_id !== avatar ||
      old.banner_id !== banner;
    statements.push(
      guard(
        db,
        "COALESCE((SELECT version FROM member_profiles WHERE member_id=?),-1)=?",
        m.id,
        int(b.version, -1),
      ),
      guard(
        db,
        "(SELECT COALESCE(SUM(amount),0) FROM reward_ledger WHERE member_id=?)=?",
        m.id,
        total,
      ),
      guard(
        db,
        "EXISTS(SELECT 1 FROM reward_settings WHERE id='main' AND version=?)",
        settings.version,
      ),
    );
    for (const [id, kind] of [
      [avatar, "avatar"],
      [banner, "banner"],
    ])
      if (id)
        statements.push(
          guard(
            db,
            "EXISTS(SELECT 1 FROM profile_images WHERE id=? AND member_id=? AND kind=? AND removed=0)",
            id,
            m.id,
            kind,
          ),
        );
    for (const id of b.badges)
      statements.push(
        guard(
          db,
          "EXISTS(SELECT 1 FROM badge_awards a JOIN badge_definitions d ON d.id=a.badge_id WHERE a.id=? AND a.member_id=? AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>?) AND d.active=1)",
          id,
          m.id,
          now,
        ),
      );
    statements.push(
      stmt(
        db,
        `INSERT INTO member_profiles(member_id,public_id,alias,bio,accent,theme,visible,board_opt_in,moderation,avatar_id,banner_id,display_badges,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET alias=excluded.alias,bio=excluded.bio,accent=excluded.accent,theme=excluded.theme,visible=excluded.visible,board_opt_in=excluded.board_opt_in,moderation=excluded.moderation,avatar_id=excluded.avatar_id,banner_id=excluded.banner_id,display_badges=excluded.display_badges,version=member_profiles.version+1,updated_at=excluded.updated_at`,
        m.id,
        old?.public_id || uid(),
        alias,
        bio,
        accent,
        theme,
        b.visible ? 1 : 0,
        b.boardOptIn ? 1 : 0,
        old?.moderation === "hidden"
          ? "hidden"
          : changed
            ? "pending"
            : old.moderation,
        avatar,
        banner,
        JSON.stringify(b.badges),
        now,
      ),
      audit(db, m.id, "profile_saved", m.id, {
        visible: !!b.visible,
        board: !!b.boardOptIn,
        reviewRequired: changed,
      }),
    );
  } else if (b.action === "profileReport") {
    const id = str(b.id, 80),
      reason = noteText(b.reason, 500);
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM member_profiles WHERE public_id=? AND visible=1 AND moderation='approved')",
        id,
      ),
      guard(
        db,
        "NOT EXISTS(SELECT 1 FROM profile_reports WHERE profile_id=? AND reporter=? AND status='open')",
        id,
        m.id,
      ),
      stmt(
        db,
        "INSERT INTO profile_reports(id,profile_id,reporter,reason,created_at) VALUES(?,?,?,?,?)",
        op.id,
        id,
        m.id,
        reason,
        now,
      ),
      audit(db, m.id, "profile_reported", id, {}),
    ];
  } else if (b.action === "rewardRule") {
    const id = str(b.id, 40);
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM reward_rules WHERE id=? AND version=?)",
        id,
        int(b.version),
      ),
      stmt(
        db,
        "UPDATE reward_rules SET points=?,period_cap=?,period_ms=?,enabled=?,version=version+1 WHERE id=?",
        int(b.points, 0, 1000),
        int(b.cap, 0, 10000),
        [86400000, 604800000].includes(b.period)
          ? b.period
          : fail("Choose daily or weekly."),
        b.enabled ? 1 : 0,
        id,
      ),
      audit(db, m.id, "reward_rule_changed", id, {
        points: b.points,
        cap: b.cap,
        period: b.period,
        enabled: !!b.enabled,
        reason: noteText(b.reason),
      }),
    ];
  } else if (b.action === "rewardSettings") {
    if (!Array.isArray(b.tiers) || !b.tiers.length || b.tiers.length > 12)
      fail("Configure 1–12 unlock tiers.");
    let previous = -1;
    const tiers = b.tiers.map((t: Row, i: number) => {
      const threshold = int(t.threshold, 0, 1000000);
      if (threshold <= previous || (!i && threshold !== 0))
        fail("Tier thresholds must start at zero and increase.");
      previous = threshold;
      return {
        name: noteText(t.name, 40, 2),
        threshold,
        slots: int(t.slots, 0, 8),
        accent: !!t.accent,
        bio: !!t.bio,
        avatar: !!t.avatar,
        banner: !!t.banner,
        theme: !!t.theme,
      };
    });
    if (!Array.isArray(b.titles) || b.titles.length !== 5)
      fail("Provide the five rank titles.");
    const titles = b.titles.map((t: string) => noteText(t, 50, 2));
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM reward_settings WHERE id='main' AND version=?)",
        int(b.version),
      ),
      stmt(
        db,
        "UPDATE reward_settings SET tiers=?,titles=?,version=version+1 WHERE id='main'",
        JSON.stringify(tiers),
        JSON.stringify(titles),
      ),
      audit(db, m.id, "reward_settings_changed", "main", {
        tiers,
        titles,
        reason: noteText(b.reason),
      }),
    ];
  } else if (b.action === "rewardAward") {
    const memberId = str(b.memberId, 80),
      reason = noteText(b.reason),
      rule = str(b.rule || "manual", 40),
      source =
        rule === "manual"
          ? str(b.source || op.id, 100)
          : noteText(b.source, 100, 3);
    statements.push(
      guard(
        db,
        "EXISTS(SELECT 1 FROM members WHERE id=? AND active=1)",
        memberId,
      ),
    );
    if (rule === "manual") {
      const amount = int(b.amount, -100000, 100000);
      if (!amount) fail("Enter a nonzero adjustment.");
      statements.push(
        stmt(
          db,
          "INSERT INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at) VALUES(?,?,?,'manual',?,?,?,?)",
          op.id,
          memberId,
          amount,
          source,
          m.id,
          reason,
          now,
        ),
      );
    } else {
      if (!["helpful_review", "feedback", "volunteer", "event"].includes(rule))
        fail("Choose an administrator recognition rule.");
      if (rule === "helpful_review")
        statements.push(
          guard(
            db,
            `EXISTS(SELECT 1 FROM product_reviews r WHERE r.id=? AND r.member_id=? AND r.removed=0 AND EXISTS(SELECT 1 FROM item_balances i JOIN orders o ON o.id=i.order_id WHERE i.product_id=r.product_id AND o.member_id=r.member_id AND o.status IN('paid','tab') AND i.remaining_qty>0))`,
            source,
            memberId,
          ),
        );
      statements.push(
        guard(
          db,
          "COALESCE((SELECT frozen FROM reward_members WHERE member_id=?),0)=0",
          memberId,
        ),
        stmt(
          db,
          "INSERT INTO reward_events(id,member_id,rule_id,source,actor,note,created_at) VALUES(?,?,?,?,?,?,?)",
          rule + ":" + memberId + ":" + source,
          memberId,
          rule,
          source,
          m.id,
          reason,
          now,
        ),
      );
    }
    statements.push(
      audit(db, m.id, "murley_bucks_awarded", memberId, {
        rule,
        source,
        amount: rule === "manual" ? b.amount : null,
        reason,
      }),
    );
  } else if (b.action === "rewardReverse") {
    const entry = await first(
      db,
      "SELECT * FROM reward_ledger WHERE id=?",
      str(b.id, 180),
    );
    if (!entry || entry.reverses) fail("Choose an original ledger entry.");
    statements = [
      stmt(
        db,
        "INSERT INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at,reverses) VALUES(?,?,?,'reversal',?,?,?,?,?)",
        op.id,
        entry.member_id,
        -entry.amount,
        entry.source,
        m.id,
        noteText(b.reason),
        now,
        entry.id,
      ),
      audit(db, m.id, "murley_bucks_reversed", entry.id, { reason: b.reason }),
    ];
  } else if (b.action === "rewardFreeze") {
    const memberId = str(b.memberId, 80);
    statements = [
      guard(
        db,
        "COALESCE((SELECT version FROM reward_members WHERE member_id=?),-1)=?",
        memberId,
        int(b.version, -1),
      ),
      stmt(
        db,
        "INSERT INTO reward_members(member_id,frozen,reason) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET frozen=excluded.frozen,reason=excluded.reason,version=reward_members.version+1",
        memberId,
        b.frozen ? 1 : 0,
        noteText(b.reason),
      ),
      audit(db, m.id, "rewards_freeze", memberId, {
        frozen: !!b.frozen,
        reason: b.reason,
      }),
    ];
  } else if (b.action === "rewardRepair") {
    const memberId = str(b.memberId, 80),
      reason = noteText(b.reason),
      missing = await rows(
        db,
        "SELECT l.* FROM reward_ledger l JOIN orders o ON o.id=l.source WHERE l.member_id=? AND l.rule_id='purchase' AND o.status='void' AND NOT EXISTS(SELECT 1 FROM reward_ledger r WHERE r.reverses=l.id)",
        memberId,
      );
    for (const l of missing)
      statements.push(
        stmt(
          db,
          "INSERT OR IGNORE INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at,reverses) VALUES(?,?,?,'reversal',?,?,?,?,?)",
          uid(),
          memberId,
          -l.amount,
          l.source,
          m.id,
          "Repair: " + reason,
          now,
          l.id,
        ),
      );
    statements.push(
      audit(db, m.id, "murley_bucks_reconciled", memberId, {
        repaired: missing.length,
        totalBefore: await rewardTotal(db, memberId),
        reason,
      }),
    );
    result.repaired = missing.length;
  } else if (b.action === "badgeSave") {
    const id = b.id ? str(b.id, 80) : op.id,
      color = str(b.color, 20),
      symbol = str(b.symbol, 20);
    if (!ACCENTS.includes(color) || !SYMBOLS.includes(symbol))
      fail("Choose an available badge design.");
    statements = [
      guard(
        db,
        "COALESCE((SELECT version FROM badge_definitions WHERE id=?),-1)=?",
        id,
        int(b.version, -1),
      ),
      stmt(
        db,
        `INSERT INTO badge_definitions(id,name,description,criteria,category,rarity,color,symbol,active) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,criteria=excluded.criteria,category=excluded.category,rarity=excluded.rarity,color=excluded.color,symbol=excluded.symbol,active=excluded.active,version=badge_definitions.version+1`,
        id,
        noteText(b.name, 60, 2),
        noteText(b.description, 400),
        noteText(b.criteria, 400),
        noteText(b.category, 50, 2),
        noteText(b.rarity, 30, 2),
        color,
        symbol,
        b.active ? 1 : 0,
      ),
      audit(db, m.id, "badge_definition", id, {
        name: b.name,
        reason: noteText(b.reason),
      }),
    ];
  } else if (b.action === "badgeIssue") {
    const memberId = str(b.memberId, 80),
      badgeId = str(b.badgeId, 80),
      expires =
        b.expiresAt == null
          ? null
          : int(b.expiresAt, now + 60000, 9999999999999),
      reason = noteText(b.reason);
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM badge_definitions WHERE id=? AND active=1)",
        badgeId,
      ),
      guard(
        db,
        "EXISTS(SELECT 1 FROM members WHERE id=? AND active=1)",
        memberId,
      ),
      stmt(
        db,
        "UPDATE badge_awards SET revoked_at=?,revoked_by=?,revoke_reason='Expired before new issuance.' WHERE member_id=? AND badge_id=? AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at<=?",
        now,
        m.id,
        memberId,
        badgeId,
        now,
      ),
      stmt(
        db,
        "INSERT INTO badge_awards(id,badge_id,member_id,issuer,reason,issued_at,expires_at) VALUES(?,?,?,?,?,?,?)",
        op.id,
        badgeId,
        memberId,
        m.id,
        reason,
        now,
        expires,
      ),
      audit(db, m.id, "badge_issued", op.id, {
        memberId,
        badgeId,
        expires,
        reason,
      }),
    ];
  } else if (b.action === "badgeRevoke") {
    const id = str(b.id, 80),
      reason = noteText(b.reason);
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM badge_awards WHERE id=? AND revoked_at IS NULL)",
        id,
      ),
      stmt(
        db,
        "UPDATE badge_awards SET revoked_at=?,revoked_by=?,revoke_reason=? WHERE id=?",
        now,
        m.id,
        reason,
        id,
      ),
      audit(db, m.id, "badge_revoked", id, { reason }),
    ];
  } else if (b.action === "profileModerate") {
    const memberId = str(b.memberId, 80),
      state = str(b.state, 20);
    if (!["approved", "hidden"].includes(state))
      fail("Choose approve or hide.");
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM member_profiles WHERE member_id=? AND version=?)",
        memberId,
        int(b.version),
      ),
      stmt(
        db,
        "UPDATE member_profiles SET moderation=?,version=version+1,updated_at=? WHERE member_id=?",
        state,
        now,
        memberId,
      ),
    ];
    if (b.removeImages)
      statements.push(
        stmt(
          db,
          "UPDATE profile_images SET removed=1 WHERE member_id=?",
          memberId,
        ),
        stmt(
          db,
          "UPDATE member_profiles SET avatar_id=NULL,banner_id=NULL WHERE member_id=?",
          memberId,
        ),
      );
    statements.push(
      audit(db, m.id, "profile_moderated", memberId, {
        state,
        removeImages: !!b.removeImages,
        reason: noteText(b.reason),
      }),
    );
  } else if (b.action === "profileResolve") {
    const id = str(b.id, 80);
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM profile_reports WHERE id=? AND status='open')",
        id,
      ),
      stmt(
        db,
        "UPDATE profile_reports SET status='resolved',resolution=? WHERE id=?",
        noteText(b.reason),
        id,
      ),
      audit(db, m.id, "profile_report_resolved", id, { reason: b.reason }),
    ];
  } else if (b.action === "seasonCreate") {
    const start = int(b.startsAt, 0, 9999999999999),
      end = int(b.endsAt, start + 60000, 9999999999999);
    if (end - start > 366 * 86400000) fail("Keep seasons within one year.");
    statements = [
      guard(
        db,
        "NOT EXISTS(SELECT 1 FROM reward_seasons WHERE starts_at<? AND ends_at>?)",
        end,
        start,
      ),
      stmt(
        db,
        "INSERT INTO reward_seasons(id,name,starts_at,ends_at) VALUES(?,?,?,?)",
        op.id,
        noteText(b.name, 80, 2),
        start,
        end,
      ),
      audit(db, m.id, "reward_season_created", op.id, { start, end }),
    ];
  } else if (b.action === "seasonArchive") {
    const id = str(b.id, 80),
      s = await first(db, "SELECT * FROM reward_seasons WHERE id=?", id);
    if (!s || s.ends_at > now || s.archived_at)
      fail("Archive a completed season.");
    statements = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM reward_seasons WHERE id=? AND version=? AND archived_at IS NULL)",
        id,
        int(b.version),
      ),
      stmt(
        db,
        `INSERT INTO reward_season_results(season_id,member_id,points,place) SELECT ?,member_id,points,RANK() OVER(ORDER BY points DESC) FROM (SELECT l.member_id,SUM(l.amount) points FROM reward_ledger l JOIN member_profiles p ON p.member_id=l.member_id JOIN members m ON m.id=l.member_id WHERE l.created_at>=? AND l.created_at<? AND m.active=1 AND p.visible=1 AND p.board_opt_in=1 AND p.moderation='approved' GROUP BY l.member_id HAVING SUM(l.amount)>0)`,
        id,
        s.starts_at,
        s.ends_at,
      ),
      stmt(
        db,
        "UPDATE reward_seasons SET archived_at=?,version=version+1 WHERE id=?",
        now,
        id,
      ),
      audit(db, m.id, "reward_season_archived", id, {
        reason: noteText(b.reason),
      }),
    ];
  } else fail("Choose a supported recognition action.");
  await op.commit(statements);
  return result;
}
