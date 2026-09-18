"use client";
import { useState } from "react";
import { Star, Shield, HandHeart, Compass, Medal, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, date, type Row } from "./shared";
import {
  useRoadmap,
  RoadmapStatus,
  ActionForm,
  CheckField,
  SelectField,
  reasonField,
  localDate,
} from "./roadmap-shared";
import { roadmapRead } from "./operations-action";
import { RewardsShop, SpendingSettings } from "./rewards-shop";
import { MemberProfileCard } from "./member-flair";
import styles from "./rewards-shop.module.css";
const accents = ["blue", "indigo", "green", "orange", "rose", "slate"],
  symbols = ["star", "shield", "hands", "compass", "medal", "flag"];
const icons: Row = {
  star: Star,
  shield: Shield,
  hands: HandHeart,
  compass: Compass,
  medal: Medal,
  flag: Flag,
};
function Badge({ badge: b }: { badge: Row }) {
  const Icon = icons[b.symbol] || Medal;
  return (
    <span
      className={"recognition-badge accent-" + b.color}
      title={b.description + " · " + b.criteria}
    >
      <Icon size={22} />
      <span>
        {b.name}
        <small>{b.rarity}</small>
      </span>
    </span>
  );
}
export default function Rewards({ admin = false, initialProfileId = "", initialReportId = "" }: { admin?: boolean; initialProfileId?: string; initialReportId?: string }) {
  const [moderationTarget, setModerationTarget] = useState({profileId: initialProfileId, reportId: initialReportId}),
    [tab, setTab] = useState(admin ? initialProfileId || initialReportId ? "moderation" : "members" : "ledger"),
    [memberId, setMemberId] = useState(""),
    [season, setSeason] = useState(""),
    [offset, setOffset] = useState(0),
    [viewProfile, setViewProfile] = useState<Row | null>(null),
    [profileError, setProfileError] = useState("");
  const state = useRoadmap({
      kind: "rewards",
      ...(admin ? { admin: "true" } : {}),
      ...(admin && moderationTarget.profileId ? {profileId: moderationTarget.profileId} : {}),
      ...(admin && moderationTarget.reportId ? {reportId: moderationTarget.reportId} : {}),
      ...(memberId ? { memberId } : {}),
      ...(season ? { season } : {}),
      offset: String(offset),
    }),
    d = state.data,
    a = state.action;
  const openProfile = async (id: string) => {
    try {
      setProfileError("");
      setViewProfile((await roadmapRead({ kind: "profile", id })).profile);
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Profile unavailable.");
    }
  };
  return (
    <section className="road-stack recognition-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Unit recognition</span>
          <h1>Murley Bucks.</h1>
          <p>
            Recognize participation, helpful ideas, and support for the team.
          </p>
        </div>
      </div>
      <RoadmapStatus state={state} />
      {d ? (
        <>
          <div className="road-tabs">
            {(admin
              ? [
                  ["members", "Member recognition"],
                  ["shop", "Rewards & raffles"],
                  ["badges", "Badge library"],
                  ["moderation", "Profile moderation"],
                  ["rules", "Rules & tiers"],
                  ["seasons", "Seasons"],
                  ["board", "Support Board"],
                ]
              : [
                  ["ledger", "My Murley Bucks"],
                  ["shop", "Use Murley Bucks"],
                  ["profile", "My profile"],
                  ["board", "Support Board"],
                ]
            ).map(([id, title]) => (
              <Button
                key={id}
                variant={tab === id ? "default" : "secondary"}
                onClick={() => setTab(id)}
              >
                {title}
              </Button>
            ))}
          </div>
          {admin && tab === "members" ? (
            <>
              <SelectField
                label="Member"
                value={memberId || d.memberId}
                onChange={(v) => {
                  setMemberId(v);
                  setOffset(0);
                }}
                options={d.members.map((m: Row) => [
                  m.id,
                  m.name + (m.active ? "" : " (inactive)"),
                ])}
              />
              <Balance data={d} />
              <div className="road-columns">
                <section className="panel">
                  <ActionForm
                    title="Recognize a contribution"
                    initial={{
                      rule: "manual",
                      amount: 10,
                      source: "",
                      reason: "",
                    }}
                    fields={[
                      {
                        key: "rule",
                        label: "Recognition type",
                        options: [
                          ["manual", "Manual award / deduction"],
                          ["volunteer", "Volunteer / restock support"],
                          ["event", "Event participation"],
                          ["feedback", "Useful feedback"],
                          ["helpful_review", "Helpful verified review"],
                        ],
                      },
                      {
                        key: "amount",
                        label: "Murley Bucks (manual only; negative to deduct)",
                        type: "number",
                        min: -100000,
                        max: 100000,
                      },
                      {
                        key: "source",
                        label:
                          "Contribution reference / review ID (optional for manual)",
                        optional: true,
                      },
                      reasonField,
                    ]}
                    busy={a.busy || !!a.pending}
                    submit={(v) =>
                      a.send({
                        action: "rewardAward",
                        memberId: d.memberId,
                        ...v,
                        source: v.source || undefined,
                        amount: Number(v.amount),
                      })
                    }
                  />
                  <p className="fine">
                    Rule-based awards obey the configured daily/weekly cap. A
                    contribution reference cannot be awarded twice. Use manual
                    recognition for past contributions; it never changes
                    purchase records.
                  </p>
                </section>
                <section className="panel road-stack">
                  <ActionForm
                    key={d.memberId + ":freeze:" + d.control.version}
                    title="Reward account controls"
                    initial={{ frozen: !!d.control.frozen, reason: "" }}
                    fields={[
                      {
                        key: "frozen",
                        label: "Pause automatic awards and reward redemption",
                        type: "checkbox",
                      },
                      reasonField,
                    ]}
                    busy={a.busy || !!a.pending}
                    submit={(v) =>
                      a.send({
                        action: "rewardFreeze",
                        memberId: d.memberId,
                        version: d.control.version,
                        ...v,
                      })
                    }
                  />
                  <ActionForm
                    title="Reconcile recognition"
                    initial={{ reason: "" }}
                    fields={[reasonField]}
                    label="Recalculate and repair void reversals"
                    busy={a.busy || !!a.pending}
                    submit={(v) =>
                      a.send({
                        action: "rewardRepair",
                        memberId: d.memberId,
                        ...v,
                      })
                    }
                  />
                  <p className="fine">
                    Totals are calculated from the append-only ledger. This
                    repairs missing reversals for voided purchases without
                    backfilling old activity.
                  </p>
                </section>
              </div>
              <section className="panel">
                <ActionForm
                  title="Issue a badge"
                  initial={{
                    badgeId: d.definitions.find((x: Row) => x.active && !x.id.startsWith("raffle-winner:"))?.id || "",
                    expires: "",
                    reason: "",
                  }}
                  fields={[
                    {
                      key: "badgeId",
                      label: "Badge",
                      options: d.definitions
                        .filter((x: Row) => x.active && !x.id.startsWith("raffle-winner:"))
                        .map((x: Row) => [x.id, x.name]),
                    },
                    {
                      key: "expires",
                      label: "Expiration (optional)",
                      type: "datetime-local",
                      optional: true,
                    },
                    reasonField,
                  ]}
                  label="Issue badge"
                  busy={a.busy || !!a.pending}
                  submit={(v) =>
                    a.send({
                      action: "badgeIssue",
                      memberId: d.memberId,
                      badgeId: v.badgeId,
                      expiresAt: v.expires
                        ? new Date(v.expires).getTime()
                        : null,
                      reason: v.reason,
                    })
                  }
                />
              </section>
              <section className="panel road-stack">
                <h2>Badge history</h2>
                {d.badgeHistory.map((b: Row) => (
                  <div className="road-item" key={b.id}>
                    <h3>{b.name}</h3>
                    <p>{b.reason}</p>
                    <p className="fine">
                      Issued {date(b.issued_at)}
                      {b.expires_at ? " · expires " + date(b.expires_at) : ""}
                      {b.revoked_at ? " · revoked " + date(b.revoked_at) : ""}
                    </p>
                    {!b.revoked_at ? (
                      <ActionForm
                        title="Revoke badge"
                        initial={{ reason: "" }}
                        fields={[reasonField]}
                        label="Revoke"
                        busy={a.busy || !!a.pending}
                        submit={(v) =>
                          a.send({ action: "badgeRevoke", id: b.id, ...v })
                        }
                      />
                    ) : (
                      <p>{b.revoke_reason}</p>
                    )}
                  </div>
                ))}
              </section>
              <Ledger
                data={d}
                admin
                action={a}
                offset={offset}
                setOffset={setOffset}
              />
            </>
          ) : null}
          {tab === "shop" ? <RewardsShop admin={admin} onChange={state.refresh} /> : null}
          {!admin && tab === "profile" ? (
            <>
              <Balance data={d} />
              {d.ownProfile ? <MemberProfileCard profile={d.ownProfile} /> : null}
              <ProfileEditor
                key={
                  (d.profile?.version ?? -1) +
                  ":" +
                  d.settings.version +
                  ":" +
                  d.tier.name
                }
                data={d}
                action={a}
              />
              <section className="panel">
                <h2>Your earned badges</h2>
                <div className="badge-shelf">
                  {d.badges.map((b: Row) => (
                    <Badge key={b.award_id} badge={b} />
                  ))}
                </div>
                {!d.badges.length ? (
                  <p className="fine">Your issued badges will appear here.</p>
                ) : null}
              </section>
            </>
          ) : null}
          {!admin && tab === "ledger" ? (
            <>
              <Balance data={d} />
              <Ledger
                data={d}
                action={a}
                offset={offset}
                setOffset={setOffset}
              />
              <Button variant="secondary" onClick={() => setTab("shop")}>Explore rewards</Button>
              <section className="panel road-stack">
                <h2>Ways to earn Murley Bucks</h2>
                {d.earning ? <p><strong>Paid purchases:</strong> 1 Murley Buck for every ${(d.earning.settings.rateCents / 100).toFixed(2)} of eligible merchandise. Fractional amounts carry forward. Tax, shipping, and purchases funded with reward credit are excluded.</p> : null}
                {d.earning ? <p className="fine">{d.earning.settings.currentWeekCapPoints ? `Spending earnings are limited to ${d.earning.settings.currentWeekCapPoints} Murley Bucks for your current earning week.` : "There is currently no weekly cap on your spending earnings."} Community and manual recognition have their own rules.</p> : null}
                {d.rules
                  .filter((r: Row) => r.enabled && r.id !== "purchase" && r.id !== "spending")
                  .map((r: Row) => (
                    <p key={r.id}>
                      {r.label}: {r.points} Murley Bucks · up to {r.period_cap}{" "}
                      per {r.period_ms === 86400000 ? "day" : "week"}.
                    </p>
                  ))}
                <p className="fine">
                  Rewards began {date(d.settings.starts_at)}. Daily and weekly
                  windows use UTC; weekly windows are fixed seven-day periods.
                  Murley Bucks can be redeemed for the rewards your admins offer. They are separate from your account credit until you choose a credit reward.
                </p>
              </section>
            </>
          ) : null}
          {admin && tab === "badges" ? (
            <BadgeLibrary data={d} action={a} />
          ) : null}
          {admin && tab === "rules" ? (
            <>
              {d.earning ? <SpendingSettings earning={d.earning} action={a} /> : null}
              <section className="panel">
                <h2>Participation rules</h2>
                <p className="fine">
                  These awards are in addition to purchase earnings. New rules affect future qualifying activity.
                </p>
                {d.rules.filter((r: Row) => r.id !== "purchase" && r.id !== "spending").map((r: Row) => (
                  <ActionForm
                    key={r.id + ":" + r.version}
                    title={r.label}
                    initial={{
                      points: r.points,
                      cap: r.period_cap,
                      period: String(r.period_ms),
                      enabled: !!r.enabled,
                      reason: "",
                    }}
                    fields={[
                      {
                        key: "points",
                        label: "Murley Bucks per event",
                        type: "number",
                        min: 0,
                        max: 1000,
                      },
                      {
                        key: "cap",
                        label: "Maximum per window",
                        type: "number",
                        min: 0,
                        max: 10000,
                      },
                      {
                        key: "period",
                        label: "Reward window",
                        options: [
                          ["86400000", "Daily"],
                          ["604800000", "Weekly"],
                        ],
                      },
                      {
                        key: "enabled",
                        label: "Rule enabled",
                        type: "checkbox",
                      },
                      { ...reasonField, label: "Note (optional)", optional: true },
                    ]}
                    busy={a.busy || !!a.pending}
                    submit={(v) =>
                      a.send({
                        action: "rewardRule",
                        id: r.id,
                        version: r.version,
                        ...v,
                        points: Number(v.points),
                        cap: Number(v.cap),
                        period: Number(v.period),
                      })
                    }
                  />
                ))}
              </section>
              <TierEditor key={d.settings.version} data={d} action={a} />
            </>
          ) : null}
          {admin && tab === "moderation" ? (
            <>
              {moderationTarget.profileId || moderationTarget.reportId ? <div className="notice"><p>Showing the profile {moderationTarget.reportId ? "and report " : ""}selected in Needs attention.</p><Button variant="secondary" onClick={() => setModerationTarget({profileId:"",reportId:""})}>Show all profile reviews</Button></div> : null}
              <p className="notice">
                New profile content is reviewed while the last approved version stays visible. Hiding a profile removes it from member views and the Support Board without deleting its reviews or requests.
              </p>
              {d.profiles.map((p: Row) => (
                <article className="panel road-stack" key={p.member_id}>
                  <h3>
                    {p.alias || "Unnamed profile"} · {p.member_name}
                  </h3>
                  <p>{p.bio}</p>
                  <p className="fine">
                    {p.moderation} ·{" "}
                    {p.visible ? "Visible when approved" : "Private"} ·{" "}
                    {p.board_opt_in ? "Board opt-in" : "Board opt-out"}
                  </p>
                  <div className="profile-preview-images">
                    {[p.avatar_id, p.banner_id].filter(Boolean).map((id) => (
                      <img
                        key={id}
                        src={"/api/profile-images?id=" + id}
                        alt="Profile image awaiting moderation"
                      />
                    ))}
                  </div>
                  <ProfileModeration key={p.member_id + ":" + p.version} profile={p} action={a} />
                </article>
              ))}
              {(moderationTarget.profileId || moderationTarget.reportId) && !d.profiles.length ? <p className="notice">The selected profile is no longer available.</p> : null}
              <section className="panel">
                <h2>{moderationTarget.reportId ? "Selected report" : "Open reports"}</h2>
                {d.reports.map((r: Row) => (
                  <div className="road-item" key={r.id}>
                    <h3>{r.alias}</h3>
                    <p>{r.reason}</p>
                    {r.status === "open" ? <ActionForm
                      title="Resolve report"
                      initial={{ reason: "" }}
                      fields={[reasonField]}
                      label="Resolve"
                      busy={a.busy || !!a.pending}
                      submit={(v) =>
                        a.send({ action: "profileResolve", id: r.id, ...v })
                      }
                    /> : <p className="fine">This report is resolved. {r.resolution}</p>}
                  </div>
                ))}
              </section>
            </>
          ) : null}
          {admin && tab === "seasons" ? (
            <section className="panel road-stack">
              <h2>Support Board seasons</h2>
              <ActionForm
                title="Create a season"
                initial={{
                  name: "",
                  starts: localDate(Date.now()),
                  ends: localDate(Date.now() + 90 * 86400000),
                }}
                fields={[
                  { key: "name", label: "Season name" },
                  { key: "starts", label: "Starts", type: "datetime-local" },
                  { key: "ends", label: "Ends", type: "datetime-local" },
                ]}
                busy={a.busy || !!a.pending}
                submit={(v) =>
                  a.send({
                    action: "seasonCreate",
                    name: v.name,
                    startsAt: new Date(v.starts).getTime(),
                    endsAt: new Date(v.ends).getTime(),
                  })
                }
              />
              {d.seasons.map((s: Row) => (
                <div className="road-item" key={s.id}>
                  <h3>{s.name}</h3>
                  <p>
                    {date(s.starts_at)} to {date(s.ends_at)}
                  </p>
                  {s.archived_at ? (
                    <p className="fine">Archived {date(s.archived_at)}</p>
                  ) : s.ends_at < Date.now() ? (
                    <ActionForm
                      title="Archive completed standings"
                      initial={{ reason: "" }}
                      fields={[reasonField]}
                      label="Archive season"
                      busy={a.busy || !!a.pending}
                      submit={(v) =>
                        a.send({
                          action: "seasonArchive",
                          id: s.id,
                          version: s.version,
                          ...v,
                        })
                      }
                    />
                  ) : (
                    <p className="fine">
                      Standings remain live until the season ends.
                    </p>
                  )}
                </div>
              ))}
            </section>
          ) : null}
          {tab === "board" ? (
            <section className="panel road-stack">
              <h2>Support Board</h2>
              <p className="fine">
                Earned recognition for helping the unit. Spending Murley Bucks does not lower standings. Equal earned totals share a rank; account balances and purchases stay private. You can leave the board in My profile.
              </p>
              <SelectField
                label="Season"
                value={season || d.season}
                onChange={setSeason}
                options={[
                  ["all", "All-time"],
                  ...d.seasons.map((s: Row) => [
                    s.id,
                    s.name + (s.archived_at ? " (archived)" : ""),
                  ]),
                ]}
              />
              {!d.board.length ? (
                <p className="notice">
                  No opted-in, approved profiles have earned Murley Bucks in
                  this view yet.
                </p>
              ) : null}
              {d.board.map((p: Row) => (
                <button
                  className="support-row"
                  key={p.id}
                  onClick={() => openProfile(p.id)}
                >
                  <strong>#{p.place}</strong>
                  <span>
                    {p.alias}
                    <small>{p.title}</small>
                  </span>
                  <span>
                    {p.points.toLocaleString()}
                    <small>earned Murley Bucks</small>
                  </span>
                </button>
              ))}
              {profileError ? (
                <p className="notice error">{profileError}</p>
              ) : null}
              {viewProfile ? (
                <PublicProfile
                  profile={viewProfile}
                  action={a}
                  close={() => setViewProfile(null)}
                />
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
export function Balance({ data: d }: { data: Row }) {
  return (
    <section className="recognition-summary">
      <span>Historical earned Murley Bucks</span>
      <strong>{Number(d.wallet?.earned ?? d.total).toLocaleString()}</strong>
      {d.wallet ? <dl className={styles.metrics}>
        <div><dt>Available to spend</dt><dd>{Number(d.wallet.available).toLocaleString()}</dd></div>
        <div><dt>Spent on rewards</dt><dd>{Number(d.wallet.spent).toLocaleString()}</dd></div>
        <div><dt>Pending payment</dt><dd>{Number(d.earning?.pendingPoints || 0).toLocaleString()}</dd></div>
      </dl> : null}
      {d.earning?.pendingPoints > 0 ? <p className="fine">Pending earnings become available after eligible purchases are paid and confirmed, subject to earning rules.</p> : null}
      {d.earning?.remainderCents > 0 ? <p className="fine">${(d.earning.remainderCents / 100).toFixed(2)} in paid eligible spending is carried toward your next Murley Buck.</p> : null}
      <p>
        {d.tier.name} · {d.tier.slots} display badge{" "}
        {d.tier.slots === 1 ? "slot" : "slots"}
      </p>
      <small>
        Earned recognition determines profile unlocks and Support Board standings. Redeeming rewards never reduces this total.
      </small>
      {d.control.frozen ? (
        <p className="notice warning">
          Automatic rewards and reward redemption are currently paused for this account. Contact an administrator for help.
        </p>
      ) : null}
    </section>
  );
}
function Ledger({
  data: d,
  admin = false,
  action: a,
  offset,
  setOffset,
}: {
  data: Row;
  admin?: boolean;
  action: ReturnType<typeof useRoadmap>["action"];
  offset: number;
  setOffset: (n: number) => void;
}) {
  const reversed = new Set(
    d.ledger.filter((l: Row) => l.reverses).map((l: Row) => l.reverses),
  );
  return (
    <section className="panel road-stack">
      <h2>Earned Murley Bucks history</h2>
      <p className="fine">Awards and earning adjustments appear here. Redeemed rewards have their own history under Use Murley Bucks.</p>
      {d.ledger.map((l: Row) => (
        <div className="road-item" key={l.id}>
          <div className="section-title">
            <strong>
              {l.amount > 0 ? "+" : ""}
              {l.amount} Murley Bucks
            </strong>
            <span className="fine">{date(l.created_at)}</span>
          </div>
          <p>{l.note}</p>
          <p className="fine">
            {l.rule_id.replaceAll("_", " ")}
            {l.reverses ? " · reversal" : ""}
          </p>
          {admin && l.rule_id === "spending" ? <p className="fine">Purchase earnings are corrected through the original transaction or refund so the financial and reward records stay linked.</p> : null}
          {admin && l.rule_id !== "spending" && !l.reverses && !reversed.has(l.id) ? (
            <ActionForm
              title="Reverse this entry"
              initial={{ reason: "" }}
              fields={[reasonField]}
              label="Record reversal"
              busy={a.busy || !!a.pending}
              submit={(v) =>
                a.send({ action: "rewardReverse", id: l.id, ...v })
              }
            />
          ) : null}
        </div>
      ))}
      {!d.ledger.length ? (
        <p className="fine">New recognition will appear here.</p>
      ) : null}
      <div className="inline-actions">
        <Button
          variant="secondary"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={!d.more}
          onClick={() => setOffset(offset + 50)}
        >
          Next
        </Button>
      </div>
    </section>
  );
}
async function uploadImage(file: File, kind: string) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw Error("Choose a JPG, PNG, or WebP under 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
        1,
        (kind === "avatar" ? 512 : 1400) / bitmap.width,
        (kind === "avatar" ? 512 : 600) / bitmap.height,
      ),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error("Could not process photo."))),
        "image/png",
      ),
    );
    const r = await fetch("/api/profile-images?kind=" + kind, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: blob,
      }),
      j = (await r.json()) as Row;
    if (!r.ok) throw Error(j.error);
    return j.id as string;
  } finally {
    bitmap.close();
  }
}
export function ProfileEditor({
  data: d,
  action: a,
}: {
  data: Row;
  action: ReturnType<typeof useRoadmap>["action"];
}) {
  const p = d.profile || {},
    t = d.tier,
    [v, set] = useState({
      alias: p.alias || "",
      bio: t.bio ? p.bio || "" : "",
      accent: t.accent ? p.accent || "blue" : "blue",
      theme: t.theme ? p.theme || "classic" : "classic",
      visible: !!p.visible,
      boardOptIn: !!p.board_opt_in,
      avatarId: t.avatar ? p.avatar_id : null,
      bannerId: t.banner ? p.banner_id : null,
      badges: (p.display_badges ? JSON.parse(p.display_badges) : [])
        .filter((id: string) => d.badges.some((b: Row) => b.award_id === id && !b.automatic))
        .slice(0, t.slots),
    }),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false);
  return (
    <form
      className="panel road-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void a.send({ action: "profileSave", version: p.version ?? -1, ...v });
      }}
    >
      <h2>Your member profile</h2>
      <p className="fine">
        Your profile and Support Board participation are enabled by default. You can turn either off below. Edits are reviewed while your last approved appearance remains visible.
      </p>
      {d.ownProfile?.memberName ? <p className="fine">Actual name: <strong>{d.ownProfile.memberName}</strong>. Signed-in members can see this name when they open your profile.</p> : null}
      {p.moderation ? <p className="status">{p.moderation === "pending" ? "Changes awaiting review" : p.moderation}</p> : null}
      <Field
        label="Display name / call sign"
        value={v.alias}
        maxLength={40}
        required
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          set({ ...v, alias: e.target.value })
        }
      />
      {t.bio ? (
        <Field
          label="Short bio"
          value={v.bio}
          maxLength={240}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            set({ ...v, bio: e.target.value })
          }
        />
      ) : null}
      {t.accent ? (
        <SelectField
          label="Accent"
          value={v.accent}
          onChange={(accent) => set({ ...v, accent })}
          options={accents.map((x) => [x, x])}
        />
      ) : null}
      {t.theme ? (
        <SelectField
          label="Profile style"
          value={v.theme}
          onChange={(theme) => set({ ...v, theme })}
          options={["classic", "gradient", "outlined"].map((x) => [x, x])}
        />
      ) : null}
      {(["avatar", "banner"] as const)
        .filter((kind) => t[kind])
        .map((kind) => (
          <div className="road-item" key={kind}>
            <Field
              label={kind === "avatar" ? "Profile picture" : "Profile banner"}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                setError("");
                try {
                  const id = await uploadImage(f, kind);
                  set((old) => ({ ...old, [kind + "Id"]: id }));
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Upload failed.");
                } finally {
                  setUploading(false);
                }
              }}
            />
            {v[kind === "avatar" ? "avatarId" : "bannerId"] ? (
              <>
                <img
                  className="profile-editor-image"
                  src={
                    "/api/profile-images?id=" +
                    v[kind === "avatar" ? "avatarId" : "bannerId"]
                  }
                  alt={kind}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => set({ ...v, [kind + "Id"]: null })}
                >
                  Remove {kind}
                </Button>
              </>
            ) : null}
          </div>
        ))}
      {d.badges.some((b: Row) => b.automatic) ? <div className="road-stack"><h3>Season recognition</h3><div className="badge-shelf">{d.badges.filter((b: Row) => b.automatic).map((b: Row) => <Badge key={b.award_id} badge={b} />)}</div><p className="fine">Season winner badges are displayed automatically until the season ends and do not use a badge slot.</p></div> : null}
      <h3>
        Displayed badges ({v.badges.length}/{t.slots})
      </h3>
      <div className="badge-shelf">
        {d.badges.filter((b: Row) => !b.automatic).map((b: Row) => (
          <label className="badge-choice" key={b.award_id}>
            <input
              type="checkbox"
              checked={v.badges.includes(b.award_id)}
              disabled={
                !v.badges.includes(b.award_id) && v.badges.length >= t.slots
              }
              onChange={(e) =>
                set({
                  ...v,
                  badges: e.target.checked
                    ? [...v.badges, b.award_id]
                    : v.badges.filter((id: string) => id !== b.award_id),
                })
              }
            />
            <Badge badge={b} />
          </label>
        ))}
      </div>
      <CheckField
        label="Let signed-in members see my approved profile"
        checked={v.visible}
        onChange={(visible) =>
          set({ ...v, visible, boardOptIn: visible ? v.boardOptIn : false })
        }
      />
      <CheckField
        label="Include me on the Support Board when my profile is visible"
        checked={v.boardOptIn}
        onChange={(boardOptIn) =>
          set({ ...v, boardOptIn, visible: boardOptIn ? true : v.visible })
        }
      />
      {error ? <p className="notice error">{error}</p> : null}
      <Button type="submit" disabled={a.busy || !!a.pending || uploading}>
        {uploading ? "Processing image…" : "Save profile"}
      </Button>
      <details>
        <summary>Profile unlocks</summary>
        <ul className="road-list">
          {d.settings.tiers.map((tier: Row) => (
            <li key={tier.threshold}>
              {tier.name}: {tier.threshold} Murley Bucks · {tier.slots} badge
              slots{tier.avatar ? " · profile picture" : ""}
              {tier.banner ? " · banner" : ""}
              {tier.bio ? " · bio" : ""}
              {tier.theme ? " · profile themes" : ""}
            </li>
          ))}
        </ul>
      </details>
    </form>
  );
}
function PublicProfile({
  profile: p,
  action: a,
  close,
}: {
  profile: Row;
  action: ReturnType<typeof useRoadmap>["action"];
  close: () => void;
}) {
  return (
    <section
      className={
        "public-profile accent-" + p.accent + " profile-theme-" + p.theme
      }
    >
      {p.banner ? (
        <img
          className="profile-banner"
          src={"/api/profile-images?id=" + p.banner}
          alt="Member banner"
        />
      ) : null}
      <div className="road-stack">
        {p.avatar ? (
          <img
            className="profile-avatar"
            src={"/api/profile-images?id=" + p.avatar}
            alt={p.alias}
          />
        ) : (
          <span className="profile-avatar placeholder">
            {p.alias.slice(0, 1)}
          </span>
        )}
        <h2>{p.alias}</h2>
        {p.memberName ? <p className="fine">{p.memberName}</p> : null}
        <p className="fine">{p.tier}</p>
        <p>{p.bio}</p>
        <div className="badge-shelf">
          {p.badges.map((b: Row) => (
            <Badge key={b.award_id} badge={b} />
          ))}
        </div>
        <details>
          <summary>Report this profile</summary>
          <ActionForm
            title="Send a moderation report"
            initial={{ reason: "" }}
            fields={[reasonField]}
            label="Report profile"
            busy={a.busy || !!a.pending}
            submit={(v) => a.send({ action: "profileReport", id: p.id, ...v })}
          />
        </details>
        <Button variant="secondary" onClick={close}>
          Close profile
        </Button>
      </div>
    </section>
  );
}
function BadgeLibrary({
  data: d,
  action: a,
}: {
  data: Row;
  action: ReturnType<typeof useRoadmap>["action"];
}) {
  const [editing, setEditing] = useState<Row | null>(null);
  return (
    <>
      <Button
        onClick={() =>
          setEditing({
            version: -1,
            active: true,
            color: "blue",
            symbol: "medal",
            rarity: "Earned",
            category: "Recognition",
          })
        }
      >
        Create badge
      </Button>
      <div className="road-columns">
        {d.definitions.map((b: Row) => (
          <article className="panel road-stack" key={b.id}>
            <Badge badge={b} />
            <p>{b.description}</p>
            <p className="fine">Criteria: {b.criteria}</p>
            <p className="fine">
              {b.active ? "Available to issue" : "Retired"}
            </p>
            {b.id.startsWith("raffle-winner:") ? <p className="fine">Automatically managed by raffle results. This distinction expires with its season.</p> : <Button variant="secondary" onClick={() => setEditing(b)}>
              Edit badge
            </Button>}
          </article>
        ))}
      </div>
      {editing ? (
        <section className="panel">
          <ActionForm
            key={(editing.id || "new") + ":" + editing.version}
            title={editing.id ? "Edit badge" : "Create badge"}
            initial={{ ...editing, reason: "" }}
            fields={[
              { key: "name", label: "Name" },
              { key: "description", label: "Description" },
              { key: "criteria", label: "Award criteria" },
              { key: "category", label: "Category" },
              { key: "rarity", label: "Rarity / distinction" },
              {
                key: "color",
                label: "Color",
                options: accents.map((x) => [x, x]),
              },
              {
                key: "symbol",
                label: "Symbol",
                options: symbols.map((x) => [x, x]),
              },
              { key: "active", label: "Available to issue", type: "checkbox" },
              { ...reasonField, label: "Note (optional)", optional: true },
            ]}
            busy={a.busy || !!a.pending}
            submit={async (v) => {
              const r = await a.send({ action: "badgeSave", ...v });
              if (r) setEditing(null);
            }}
          />
          <Button variant="secondary" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </section>
      ) : null}
    </>
  );
}
function TierEditor({
  data: d,
  action: a,
}: {
  data: Row;
  action: ReturnType<typeof useRoadmap>["action"];
}) {
  const [tiers, setTiers] = useState<Row[]>(d.settings.tiers),
    [titles, setTitles] = useState<string[]>(d.settings.titles),
    [reason, setReason] = useState("");
  return (
    <form
      className="panel road-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void a.send({
          action: "rewardSettings",
          version: d.settings.version,
          tiers,
          titles,
          reason,
        });
      }}
    >
      <h2>Profile unlock tiers</h2>
      <p className="fine">
        Thresholds start at zero and increase. Changing a threshold immediately
        changes available customization; earned ledger history remains intact.
      </p>
      {tiers.map((t, index) => (
        <div className="road-item" key={index}>
          <div className="road-fields">
            <Field
              label="Tier name"
              value={t.name}
              required
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setTiers(
                  tiers.map((x, i) =>
                    i === index ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
            <Field
              label="Murley Bucks required"
              type="number"
              min={0}
              value={t.threshold}
              required
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setTiers(
                  tiers.map((x, i) =>
                    i === index
                      ? { ...x, threshold: Number(e.target.value) }
                      : x,
                  ),
                )
              }
            />
            <Field
              label="Badge slots"
              type="number"
              min={0}
              max={8}
              value={t.slots}
              required
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setTiers(
                  tiers.map((x, i) =>
                    i === index ? { ...x, slots: Number(e.target.value) } : x,
                  ),
                )
              }
            />
          </div>
          <div className="road-fields">
            {["accent", "bio", "avatar", "banner", "theme"].map((key) => (
              <CheckField
                key={key}
                label={key[0].toUpperCase() + key.slice(1)}
                checked={!!t[key]}
                onChange={(v) =>
                  setTiers(
                    tiers.map((x, i) => (i === index ? { ...x, [key]: v } : x)),
                  )
                }
              />
            ))}
          </div>
          {index > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTiers(tiers.filter((_, i) => i !== index))}
            >
              Remove tier
            </Button>
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={tiers.length >= 12}
        onClick={() =>
          setTiers([
            ...tiers,
            {
              name: "New tier",
              threshold: tiers[tiers.length - 1].threshold + 100,
              slots: 1,
              accent: true,
              bio: false,
              avatar: false,
              banner: false,
              theme: false,
            },
          ])
        }
      >
        Add tier
      </Button>
      <h3>Support Board rank titles</h3>
      {titles.map((title, i) => (
        <Field
          key={i}
          label={"Rank " + (i + 1)}
          value={title}
          required
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setTitles(titles.map((x, j) => (j === i ? e.target.value : x)))
          }
        />
      ))}
      <Field
        label="Configuration note (optional)"
        value={reason}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          setReason(e.target.value)
        }
      />
      <Button type="submit" disabled={a.busy || !!a.pending}>
        Save tiers and titles
      </Button>
    </form>
  );
}

function ProfileModeration({ profile: p, action: a }: { profile: Row; action: ReturnType<typeof useRoadmap>["action"] }) {
  const [state, setState] = useState("approved"), [removeImages, setRemoveImages] = useState(false), [reason, setReason] = useState("");
  const reasonRequired = state === "hidden" || removeImages;
  return <form className="road-form" onSubmit={(e) => {
    e.preventDefault();
    void a.send({ action: "profileModerate", memberId: p.member_id, version: p.version, state, removeImages, reason });
  }}>
    <h3>Review profile</h3>
    <SelectField label="Decision" value={state} onChange={setState} options={[["approved", "Approve / restore"], ["hidden", "Hide from member views"]]} />
    <CheckField label="Remove current profile images" checked={removeImages} onChange={setRemoveImages} />
    {reasonRequired ? <Field label="Moderation reason" required minLength={5} value={reason} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)} /> : null}
    <Button disabled={a.busy || !!a.pending}>{state === "approved" ? "Approve profile" : "Hide profile"}</Button>
  </form>;
}
