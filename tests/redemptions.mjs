import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const out = path.resolve(".sites-runtime/redemption-tests");
for (const f of fs.readdirSync("lib", { recursive: true }).filter(f => f.endsWith(".ts"))) {
  const dest = path.join(out, "lib", f.replace(/\.ts$/, ".mjs"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, ts.transpileModule(fs.readFileSync(path.join("lib", f), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from (["'])(\.{1,2}\/[^"']+)\1/g, 'from "$2.mjs"'));
}
fs.writeFileSync(out + "/lib/pilot/owner.mjs", "export const OWNER_EMAIL='owner@example.test';");
const { mutateRedemptions, redemptionPage, rewardWallet, randomTicket } = await import(out + "/lib/pilot/redemptions.mjs");
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const f of ["drizzle/0000_tiny_shape.sql", "drizzle/0001_absent_guardsmen.sql", "AUTH-SCHEMA.sql", "PRODUCT-SCHEMA.sql", "SECURITY-SCHEMA.sql", "BETA-SCHEMA.sql", "ROUNDS-SCHEMA.sql"])
  sqlite.exec(fs.readFileSync(f, "utf8"));
const run = (sql, ...values) => sqlite.prepare(sql).run(...values), get = (sql, ...values) => sqlite.prepare(sql).get(...values);
run("INSERT INTO settings(id,enabled) VALUES('main',1)");
for (const [id, role] of [["owner", "admin"], ["member", "member"], ["other", "member"]])
  run("INSERT INTO members(id,email,name,role,debt,credit) VALUES(?,?,?,?,?,?)", id, id + "@example.test", id + " Person", role, id === "member" ? 1200 : 0, id === "member" ? 100 : 0);
for (const f of ["GUEST-SCHEMA.sql", "AUTOPILOT-SCHEMA.sql", "REWARDS-SCHEMA.sql", "PROFILE-EXPERIENCE-SCHEMA.sql"])
  sqlite.exec(fs.readFileSync(f, "utf8"));
run("INSERT INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at) VALUES('prior-points','member',500,'manual','history','owner','Existing recognition',1)");
run("INSERT INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at) VALUES('other-points','other',50,'manual','history','owner','Existing recognition',1)");
const before = JSON.stringify(sqlite.prepare("SELECT * FROM members ORDER BY id").all());
for (let repeat = 0; repeat < 2; repeat++)
  for (const f of ["EARNING-SCHEMA.sql", "REDEMPTION-SCHEMA.sql"]) sqlite.exec(fs.readFileSync(f, "utf8"));
assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM members ORDER BY id").all()), before, "additive repeat migrations preserve accounts");
class S {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new S(this.sql, values); }
  async first() { return get(this.sql, ...this.values) || null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
  async run() { return { meta: { changes: run(this.sql, ...this.values).changes } }; }
}
const db = {
  prepare: sql => new S(sql),
  batch: async statements => {
    sqlite.exec("BEGIN");
    try { const result = statements.map(s => run(s.sql, ...s.values)); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
const users = Object.fromEntries(["owner", "member", "other"].map(id => [id, get("SELECT * FROM members WHERE id=?", id)]));
const body = value => ({ requestId: crypto.randomUUID(), ...value });
const action = (who, value) => mutateRedemptions(db, users[who], body(value));
const reward = id => get("SELECT * FROM redemption_rewards WHERE id=?", id);
const raffle = id => get("SELECT * FROM reward_raffles WHERE id=?", id);
const raffleBody = (name, mode = "internal") => ({ action: "raffleSave", name, description: "A free unit event with optional Murley Bucks tickets.", mode, active: true, startsAt: Date.now() - 10000, endsAt: Date.now() + 3600000 });
const creditBody = { action: "redemptionRewardSave", name: "Five dollar credit", description: "Use for purchases or tabs.", kind: "credit", points: 50, creditCents: 500, active: true, stockLimit: 4 };
await assert.rejects(() => action("member", creditBody), /administrator/);
await assert.rejects(() => redemptionPage(db, users.member, {}, true), /administrator/);
const creditId = (await action("owner", creditBody)).id;
const redeem = body({ action: "rewardRedeem", rewardId: creditId, version: 0, quantity: 2 });
await mutateRedemptions(db, users.member, redeem);
assert.deepEqual(await rewardWallet(db, "member"), { earned: 500, spent: 100, available: 400, frozen: false });
assert.deepEqual({ ...get("SELECT debt,credit FROM members WHERE id='member'") }, { debt: 1200, credit: 1100 });
assert.equal(get("SELECT reward_credit_cents FROM earning_accounts WHERE member_id='member'").reward_credit_cents, 1000);
assert.equal(get("SELECT COUNT(*) count FROM reward_redemptions").count, 1);
await mutateRedemptions(db, users.member, redeem);
assert.equal(get("SELECT credit FROM members WHERE id='member'").credit, 1100, "retry cannot issue duplicate credit");
await assert.rejects(() => mutateRedemptions(db, users.member, { ...redeem, quantity: 1 }), /already used/);
await assert.rejects(() => action("other", { action: "rewardRedeem", rewardId: creditId, version: 0, quantity: 2 }), /enough available/);
await assert.rejects(() => action("member", { action: "rewardRedeem", rewardId: creditId, version: 9 }), /changed/);
run("INSERT INTO reward_members(member_id,frozen) VALUES('member',1)");
await assert.rejects(() => action("member", { action: "rewardRedeem", rewardId: creditId, version: 0 }), /changed|paused/);
run("UPDATE reward_members SET frozen=0 WHERE member_id='member'");
await assert.rejects(() => action("owner", { ...creditBody, id: creditId, version: 0, points: 60 }), /note/);
await action("owner", { ...creditBody, id: creditId, version: 0, points: 60, reason: "Change reward rate for future redemptions" });
assert.equal(get("SELECT points FROM reward_redemptions WHERE id=?", redeem.requestId).points, 100, "catalog edits never rewrite the redemption snapshot");
await action("owner", { ...creditBody, id: creditId, version: 1, points: 60, active: false });
await assert.rejects(() => action("member", { action: "rewardRedeem", rewardId: creditId, version: 2 }), /not currently/);
assert.equal((await redemptionPage(db, users.member, {})).catalog.length, 0, "inactive rewards are hidden");
await action("owner", { ...creditBody, id: creditId, version: 2, points: 60 });
// A competing redemption exhausts availability between read and write; transaction guards stop double spending.
const racer = { ...db, batch: async statements => {
  run("INSERT INTO reward_redemptions(id,member_id,reward_id,reward_name,kind,quantity,points,credit_cents,created_at) VALUES('race','other',?,'Concurrent credit','credit',1,50,0,?)", creditId, Date.now());
  return db.batch(statements);
} };
const cheapId = (await action("owner", { ...creditBody, name: "Small credit", points: 25, creditCents: 100, stockLimit: null })).id;
await assert.rejects(() => mutateRedemptions(racer, users.other, body({ action: "rewardRedeem", rewardId: cheapId, version: 0 })), /changed/);
assert.equal(get("SELECT credit FROM members WHERE id='other'").credit, 0);
assert.equal(get("SELECT COUNT(*) count FROM reward_redemptions WHERE reward_id=?", cheapId).count, 0);
// Raffle entries allocate continuous numbered ranges; no payment or visitor account is created.
const raffleId = (await action("owner", raffleBody("Unit appreciation raffle"))).id;
const ticketReward = (await action("owner", { action: "redemptionRewardSave", name: "Two event tickets", description: "Two numbered entries.", kind: "raffle", points: 10, ticketQuantity: 2, raffleId, active: true, stockLimit: null })).id;
await action("member", { action: "rewardRedeem", rewardId: ticketReward, version: 0, quantity: 2 });
const entry = get("SELECT * FROM raffle_entries WHERE raffle_id=?", raffleId);
assert.deepEqual([entry.ticket_start, entry.ticket_end, entry.quantity], [1, 4, 4]);
const guestBody = body({ action: "raffleEntryAdd", raffleId, version: raffle(raffleId).version, visitorName: "Private visitor name", quantity: 3 });
await mutateRedemptions(db, users.owner, guestBody);
await mutateRedemptions(db, users.owner, guestBody);
assert.equal(raffle(raffleId).ticket_count, 7);
assert.equal(get("SELECT COUNT(*) count FROM members").count, 3);
assert.equal(get("SELECT COUNT(*) count FROM orders").count, 0);
assert.equal(get("SELECT COUNT(*) count FROM payments").count, 0);
const memberView = await redemptionPage(db, users.member, {}), adminView = await redemptionPage(db, users.owner, { raffleId }, true);
assert.equal(memberView.entries.length, 1);
assert.ok(!JSON.stringify(memberView).includes("Private visitor name"), "visitor details are restricted to administrators");
assert.equal(adminView.entries.length, 2);
assert.deepEqual(adminView.entries.map(e => [e.ticket_start, e.ticket_end]).sort((a, b) => a[0] - b[0]), [[1, 4], [5, 7]]);
await assert.rejects(() => action("member", { action: "raffleEntryAdd", raffleId, version: 2, memberId: "member", quantity: 1 }), /administrator/);
await assert.rejects(() => action("owner", { action: "raffleExternalResult", raffleId, version: raffle(raffleId).version, confirmed: true, winningTicket: 1, reason: "Outside drawing" }), /configured/);
await assert.rejects(() => action("owner", { ...raffleBody("Unit appreciation raffle", "external"), id: raffleId, version: raffle(raffleId).version }), /fixed/);
await assert.rejects(() => action("owner", { action: "raffleDraw", raffleId, version: raffle(raffleId).version }), /Confirm/);
const drawBody = body({ action: "raffleDraw", raffleId, version: raffle(raffleId).version, confirmed: true });
const drawn = await mutateRedemptions(db, users.owner, drawBody);
assert.ok(drawn.winningTicket >= 1 && drawn.winningTicket <= 7);
assert.equal((await mutateRedemptions(db, users.owner, drawBody)).draw.winning_ticket, drawn.winningTicket);
await assert.rejects(() => action("owner", { ...drawBody, requestId: crypto.randomUUID() }), /final result/);
await assert.rejects(() => action("owner", { action: "raffleEntryAdd", raffleId, version: raffle(raffleId).version, visitorName: "Late visitor", quantity: 1 }), /changed/);
await assert.rejects(() => action("member", { action: "rewardRedeem", rewardId: ticketReward, version: 0 }), /not accepting/);
assert.throws(() => run("DELETE FROM raffle_draws WHERE raffle_id=?", raffleId), /final/);
// Outside draws still verify an issued ticket and create the same seasonal badge and audit record.
const outside = (await action("owner", raffleBody("Outside drawing", "external"))).id;
await action("owner", { action: "raffleEntryAdd", raffleId: outside, version: 0, memberId: "member", quantity: 5 });
await assert.rejects(() => action("owner", { action: "raffleExternalResult", raffleId: outside, version: 1, confirmed: true, winningTicket: 5, reason: "Drawn from physical ticket bowl" }), /Pause entries/);
const outsideRow = raffle(outside);
await action("owner", { action: "raffleSave", id: outside, version: 1, name: outsideRow.name, description: outsideRow.description, mode: outsideRow.mode, active: false, startsAt: outsideRow.starts_at, endsAt: outsideRow.ends_at });
await assert.rejects(() => action("owner", { action: "raffleExternalResult", raffleId: outside, version: 2, confirmed: true, winningTicket: 5, reason: "" }), /note/);
await assert.rejects(() => action("owner", { action: "raffleExternalResult", raffleId: outside, version: 2, confirmed: true, winningTicket: 6, reason: "Drawn from physical ticket bowl" }), /whole-number/);
await action("owner", { action: "raffleExternalResult", raffleId: outside, version: 2, confirmed: true, winningTicket: 5, reason: "Drawn from physical ticket bowl" });
const season = get("SELECT * FROM reward_seasons WHERE starts_at<=? AND ends_at>? AND archived_at IS NULL", Date.now(), Date.now());
const badge = get("SELECT * FROM badge_awards WHERE badge_id=? AND member_id='member'", "raffle-winner:" + season.id);
assert.equal(badge.expires_at, season.ends_at, "winner flair ends at the current season boundary");
assert.equal(get("SELECT COUNT(*) count FROM badge_awards WHERE badge_id=? AND member_id='member'", badge.badge_id).count, 1);
assert.equal(get("SELECT COUNT(*) count FROM audit WHERE kind='raffle_draw_recorded'").count, 2);
assert.throws(() => run("UPDATE reward_redemptions SET points=0"), /immutable/);
assert.throws(() => run("DELETE FROM raffle_entries"), /immutable/);
assert.deepEqual(await rewardWallet(db, "member"), { earned: 500, spent: 120, available: 380, frozen: false }, "redeemed rewards do not reduce historical earned points");
for (const count of [1, 2, 3, 100000]) { const ticket = randomTicket(count); assert.ok(ticket >= 1 && ticket <= count); }
// Idempotent schema reapplication cannot erase points, redemptions, ticket ownership, or a final draw.
const finalSnapshot = JSON.stringify(sqlite.prepare("SELECT * FROM reward_redemptions ORDER BY id").all());
sqlite.exec(fs.readFileSync("REDEMPTION-SCHEMA.sql", "utf8"));
assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM reward_redemptions ORDER BY id").all()), finalSnapshot);
assert.equal(get("SELECT COUNT(*) count FROM raffle_draws").count, 2);
if (process.env.REDEMPTION_FIXTURE_FILE) {
  const open = (await action("owner", raffleBody("Fall crew appreciation raffle"))).id;
  await action("owner", { action: "raffleEntryAdd", raffleId: open, version: 0, memberId: "member", quantity: 2 });
  await action("owner", { action: "redemptionRewardSave", name: "Fall raffle entry", description: "Redeem Murley Bucks for an entry in this season's crew appreciation draw.", kind: "raffle", points: 10, ticketQuantity: 1, raffleId: open, active: true, stockLimit: null });
  const { rewardsPage } = await import(out + "/lib/pilot/rewards.mjs");
  const fixture = { admin: await redemptionPage(db, users.owner, { raffleId: open }, true), member: await redemptionPage(db, users.member, {}),
    rewardsAdmin: await rewardsPage(db, users.owner, {}, true), rewardsMember: await rewardsPage(db, users.member, {}),
    members: Object.values(users), generatedFrom: "Disposable test database only" };
  fs.mkdirSync(path.dirname(path.resolve(process.env.REDEMPTION_FIXTURE_FILE)), { recursive: true });
  fs.writeFileSync(process.env.REDEMPTION_FIXTURE_FILE, JSON.stringify(fixture, null, 2));
}
console.log("Redemption and raffle tests passed: preservation, atomic balances, provenance, replay, authorization, privacy, tickets, final draws and seasonal badges.");
sqlite.close();
