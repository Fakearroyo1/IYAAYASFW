# Remaining roadmap release

For the subsequent dollar-based earning, redemption, raffle, profile, and grouped-navigation update, use [Murley Bucks and everyday admin workflows](murley-bucks-and-workflows.md). That update replaces the fixed purchase bonus described below; this document records the original rounds 5–7 release.

This release covers the remaining agreed roadmap except Round 8 integrations and optional conveniences. The snack shop retains its quick add-to-tab experience. Murley Bucks are recognition points, separate from money, account credit, prices, and checkout.

## Where to find the new controls

| Area | Location | Included |
| --- | --- | --- |
| Inventory planning | Manage → Inventory planning | Thirty-day usage, estimated stockout, repeat buyers, ratings, vendor/case-pack/lead-time settings, explainable restock quantities, shrink by item and category |
| Restock runs | Inventory planning → Restock runs | Multi-item shopping runs, reasoned quantity overrides, actual costs, receipt reference, checked receiving, weighted stock cost, one recorded expense |
| Count sessions | Inventory planning → Count sessions | Prioritized 3–5 item counts, expected/actual stock, categorized variance and reasons, concurrent-sale protection |
| Month close | Manage → Close month | Seven reconciliation checkpoints, pending-payment check, current balance snapshot, cash count, Cash App reference, immutable report download, reasoned reopen history |
| Guest storefront | Manage → Guest gear; separate gear host | Campaign codes, product/option selection, dates and limits, pickup and US shipping, pending payment, reservation expiry, private receipts, paid fulfillment and tracking |
| Delivery prices | Inventory → Gear Manager | Per-option delivery eligibility and shipping charges; campaign cap/free-shipping threshold |
| Murley Bucks | Recognition; Manage → Murley Bucks | New-activity awards, caps, tiers, rule controls, manual recognition, reversals and member award freeze |
| Badges | Murley Bucks admin controls | Badge library, issue/revoke with reasons, optional expiry, retained award history, member-selected display badges |
| Profiles and Support Board | Recognition | Opt-in alias/profile, tier-based customization, moderated images, reports, ranked seasonal board, seasonal archives, editable rank titles |
| Admin inbox | Manage → Needs attention | Guest fulfillment, profile approvals and profile reports join existing operational tasks |

## Starting behavior

- Automatic points begin when the rewards schema is first deployed. Re-running the migration preserves that start time. Existing activity is not backfilled.
- Admins can award past contributions with a recorded reason. Rules reward capped participation, not spending amounts. Purchase reversals cannot create repeat daily points.
- Default rule amounts/caps: first qualifying daily purchase 5/5 daily; full on-time tab settlement 10/10 weekly; helpful review 5/10 weekly; accepted request 10/20 weekly; feedback 5/10 weekly; volunteering 20/60 weekly; event participation 10/30 weekly. Admin-reviewed contributions require a source reference to prevent duplicates.
- Default tier thresholds are 0, 25, 75, 150, 300, and 600 points. Admins can edit them. Recognition has no monetary redemption in this release.
- Public profiles and board participation require opt-in. Profile content/images require approval. Hiding or opting out also removes visibility from archived standings. The default first-place title is “Snack Dump Chief”; rank titles are editable.
- The initial season is the calendar quarter containing the first deployment. Admins create subsequent seasons and archive completed ones.
- Guest ordering starts closed. Its separate runtime secret and domain must be configured before opening a campaign. See [Cloudflare setup](gear-cloudflare-setup.md).
- Reports state their basis: UTC calendar month, sales net of corrections, outstanding balances captured at report time. Unknown costs remain unknown rather than becoming invented profit.

## Data and security

The three additive, repeatable schemas preserve existing IDs, inventory, balances, purchases, payments, and audit history. New financial workflows use the existing transaction and correction records. No production data is copied into the review sandbox.

Admin writes retain current-session MFA and transaction-level authorization guards. New endpoints enforce role/ownership checks, same-origin writes, bounded payloads, rate limits, prepared SQL, version checks, and idempotency. Guest routes expose only campaign shopping and owned receipts, with signed host-only sessions and hashed codes/receipt keys. They cannot access member/admin routes or financial accounts.

Uploaded profile photos are bounded, parsed, decompressed with size limits, and re-encoded into sanitized PNGs before storage. Public image access checks current profile approval, visibility, and unlocks. Rewards and month-close snapshots retain append-only audit history.

## Verification

Validation covers the existing authentication, admin MFA, financial corrections, tab/credit races, inventory, community, image, backup and prior-round suites, plus new SQLite/D1 workflow tests and real workerd HTTP tests for both Workers. Targeted cases include repeat migrations, unauthorized writes, code rotation, personalized preorders, shared-stock concurrency, duplicate submissions, partial/full guest refunds including shipping, expiry versus paid orders, restock receiving, stale counts, month locks, reward caps/reversals, badge expiry, profile moderation/privacy, and malformed image uploads.

The private Sites replica uses disposable sample records for visual/process review. Desktop and 390-pixel phone walkthroughs cover the shop, Recognition, admin controls, restock receiving, badge issuance, and guest delivery/payment screens in light and dark themes. It demonstrates interactions without sending payments or touching production.

## Deferred

Round 8 remains out of scope: UPC/scanning, shelf QR shortcuts, offline/PWA enhancements, and external integrations. Processor-driven payment capture, automated promotional messaging, and the previously excluded public transparency page are also not added.

## Rollback

Close guest ordering before reverting guest code. Revert application code through the repository or Worker version controls while retaining additive tables and immutable records. Correct transactions through audited workflows; do not restore old business data over subsequent activity.
