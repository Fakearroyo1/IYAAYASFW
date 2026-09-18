// Render real reward controls with fixture records; no requests or production writes.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { buildSync } = require(require.resolve("esbuild", { paths: [require.resolve("wrangler/package.json")] }));
const directory = resolve(".sites-runtime/rewards-ui");
mkdirSync(directory, { recursive: true });
for (const entry of ["rewards", "rewards-shop", "member-flair"]) {
  buildSync({ entryPoints: ["app/store/" + entry + ".tsx"], outfile: directory + "/" + entry + ".cjs", bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom"], loader: { ".css": "empty" }, logLevel: "silent" });
}
const { Balance, ProfileEditor } = require(directory + "/rewards.cjs");
const { Catalog, RaffleManager, SpendingSettings } = require(directory + "/rewards-shop.cjs");
const { MemberProfileCard } = require(directory + "/member-flair.cjs");
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
let checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; };
const action = { busy: false, pending: null, send: async () => ({ ok: true }), retry: async () => {}, notice: "", error: "" };
const now = Date.now();
const badge = { award_id: "badge-one", name: "Helpful member", description: "Team contribution", criteria: "Admin recognized contribution", rarity: "Earned", color: "blue", symbol: "medal", automatic: false };
const winner = { ...badge, award_id: "winner-one", name: "Raffle Winner", rarity: "Seasonal", automatic: true };
const base = {
  total: 125, wallet: { earned: 125, available: 85, spent: 40 },
  earning: { pendingPoints: 12, settings: { rateCents: 100, startsAt: now, weeklyCapPoints: 0, version: 0 } },
  tier: { name: "Supporter", slots: 2, bio: true, accent: true, avatar: false, banner: false, theme: true },
  control: { frozen: 0 }, settings: { tiers: [], titles: [] }, badges: [badge, winner],
  ownProfile: { memberName: "Alex Example" },
  profile: { version: 1, alias: "Falcon", visible: 0, board_opt_in: 0, moderation: "approved", display_badges: "[]" },
};
let html = render(Balance, { data: base });
check(/Historical earned Murley Bucks.*125/s.test(html), "Historical earned remains visible after spending");
check(/Available to spend.*85/s.test(html) && /Spent on rewards.*40/s.test(html), "Spendable balance and spent rewards are separate");
check(/Pending payment.*12/s.test(html), "Unpaid earnings are not presented as spendable points");
check(html.includes("Redeeming rewards never reduces this total"), "Wallet explains that redeeming preserves earned recognition");
const credit = { id: "credit", name: "One dollar credit", description: "Use when you choose", kind: "credit", points: 10, credit_cents: 100, active: 1, stock_limit: null, issued_count: 0, version: 0 };
const raffle = { id: "raffle-one", name: "Autumn event", description: "Team appreciation", mode: "internal", active: 1, starts_at: now - 60000, ends_at: now + 86400000, status: "open", ticket_count: 3, version: 0 };
const ticketReward = { ...credit, id: "tickets", kind: "raffle", name: "Event ticket", raffle_id: raffle.id, ticket_quantity: 1, credit_cents: 0 };
const catalogData = { wallet: base.wallet, catalog: [credit, { ...credit, id: "inactive", name: "Inactive reward", active: 0 }, ticketReward], raffles: [raffle] };
html = render(Catalog, { data: catalogData, action, admin: false });
check(html.includes("One dollar credit") && !html.includes("Inactive reward"), "Members see active reward options only");
check(html.includes("Event ticket"), "An enabled raffle in its entry window is redeemable");
check(html.includes("available immediately for a tab or a new purchase"), "Credit rewards explain immediate use for tabs and purchases");
check(!html.includes("Edit reward") && !html.includes("Deactivate"), "Member catalog omits administrative controls");
html = render(Catalog, { data: { ...catalogData, raffles: [{ ...raffle, active: 0 }] }, action, admin: false });
check(!html.includes("Event ticket"), "Inactive raffle rewards are completely hidden");
html = render(Catalog, { data: { ...catalogData, raffles: [{ ...raffle, starts_at: now + 100000 }] }, action, admin: false });
check(!html.includes("Event ticket"), "A raffle does not appear before its opening time");
html = render(Catalog, { data: { ...catalogData, wallet: { available: 2 }, catalog: [credit] }, action, admin: false });
check(/<button[^>]*disabled[^>]*>Need 8 more<\/button>/.test(html), "Insufficient balance prevents starting redemption and states the shortfall");
html = render(Catalog, { data: { ...catalogData, catalog: [{ ...credit, stock_limit: 2, issued_count: 2 }] }, action, admin: false });
check(/<button[^>]*disabled[^>]*>Fully redeemed<\/button>/.test(html), "Exhausted limited rewards cannot be redeemed");
html = render(Catalog, { data: { ...catalogData, catalog: [credit] }, action: { ...action, pending: { requestId: "uncertain" } }, admin: false });
check(/<button[^>]*disabled[^>]*>Choose reward<\/button>/.test(html), "Unknown confirmation blocks a new redemption until retry resolves");
html = render(Catalog, { data: { ...catalogData, wallet: { ...base.wallet, frozen: true }, catalog: [credit] }, action, admin: false });
check(/<button[^>]*disabled[^>]*>Redemption paused<\/button>/.test(html), "A frozen rewards account has an explicit disabled redemption state");
html = render(Catalog, { data: catalogData, action, admin: true });
check(html.includes("Inactive reward") && html.includes("Activate"), "Admins can see and reactivate inactive rewards");
html = render(ProfileEditor, { data: base, action });
check(html.includes("Actual name:") && html.includes("Alex Example"), "Member sees the actual name that appears when a profile is opened");
check(!html.includes('checked=""'), "A member's previously saved profile and board opt-outs stay unchecked");
check(html.includes("Raffle Winner") && html.includes("do not use a badge slot"), "Season winner distinction is explained separately from badge slots");
check((html.match(/class="badge-choice"/g) || []).length === 1, "Automatic seasonal winner badge is not a selectable slot-consuming badge");
html = render(ProfileEditor, { data: { ...base, profile: { ...base.profile, visible: 1, board_opt_in: 1 } }, action });
check((html.match(/checked=""/g) || []).length === 2, "Auto-enrolled profile and board choices are visible and independently editable");
html = render(MemberProfileCard, { profile: { id: "profile-one", alias: "Falcon", memberName: "Alex Example", bio: "Unit volunteer", tier: "Supporter", accent: "blue", theme: "classic", badges: [winner], avatar: null, banner: null } });
check(html.includes("Falcon") && html.includes("Alex Example") && html.includes("Raffle Winner"), "The full profile shows alias, actual name and recognition together");
const raffleData = { raffles: [raffle], entries: [{ id: "entry-one", name: "Visiting supporter", visitor_name: "Visiting supporter", member_id: null, ticket_start: 1, ticket_end: 3, quantity: 3 }], members: [{ id: "member-one", name: "Alex Example", active: 1 }], entriesMore: false };
const raffleProps = { data: raffleData, action, raffleId: raffle.id, setRaffleId: () => {}, entryOffset: 0, setEntryOffset: () => {} };
html = render(RaffleManager, raffleProps);
check(html.includes("Visitor without an account") && html.includes("No payment is needed"), "Raffle administration supports free visitors without inventing a purchase or account");
check(html.includes("season in which the draw occurs"), "Winner badges explain the current season boundary");
check(html.includes("Export all tickets") && html.includes("Draw a winner"), "Managed draw provides both entry export and explicit draw action");
html = render(RaffleManager, { ...raffleProps, data: { ...raffleData, raffles: [{ ...raffle, mode: "external" }] } });
check(html.includes("Record outside winner") && !html.includes("Draw a winner"), "An outside draw uses its recorded result workflow");
check(html.includes("Pause entries for the draw") && /<button[^>]*disabled[^>]*>Record outside winner/.test(html), "Outside draws require freezing the entry pool before recording a winner");
check(/<button[^>]*disabled[^>]*>.*?Export all tickets<\/button>/.test(html), "A final outside draw export is unavailable while entries can still change");
html = render(RaffleManager, { ...raffleProps, data: { ...raffleData, raffles: [{ ...raffle, status: "drawn", winner: { display_name: "Visiting supporter", ticket: 2 } }] } });
check(html.includes("Draw complete") && !html.includes("Add free tickets") && !html.includes("Draw a winner"), "A completed draw cannot be redrawn or given more entries through the UI");
html = render(SpendingSettings, { earning: base.earning, action });
check(html.includes("1 Murley Buck per") && html.includes("$1.00") && html.includes("0 = no cap"), "Earning defaults and no-cap option are clear");
check(html.includes("next new earning week"), "Cap changes explain their effective timing");
console.log(checks + " reward, raffle, profile and pending-state rendering checks passed.");
