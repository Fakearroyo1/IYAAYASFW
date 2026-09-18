# Remaining roadmap implementation

Baseline: main `ca0eebdd6b7674db1e0bff59a63fbc4d7702a959` (rounds 3–4).

The saved roadmap uses release numbers that differ from the implementation rounds. This patch covers the remaining guest gear, inventory operations, and community engagement work. Existing request/trial/preorder workflows are retained. Round 8 integrations and optional conveniences (including UPC scanning, shelf QR links and offline/PWA enhancements), processor-driven charges, promotional messaging, and the excluded public transparency page are outside this patch.

## Current workflows and ownership

| Workflow | Current behavior | Change / authoritative surface |
| --- | --- | --- |
| Guest gear | An MFA-verified admin records a paid guest sale. No external checkout. | Separate gear Worker exposes campaign entry, catalog, order submission and own receipts only. Campaign controls, payment confirmation, fulfillment and correction remain in the protected member application. |
| Gear data | Gear Manager saves products/options; orders use shared stock. | Campaigns select existing published products/options. No duplicate catalog or inventory. |
| Restocking | Receive one product at a time; pricing is separate. | Inventory planning adds explainable suggestions, vendor/pack settings and multi-line restock runs. Receiving retains stock/cost/expense history. |
| Counts | Direct reasoned stock corrections. | Small count sessions capture expected/actual quantities, stale-stock guards and categorized variance. |
| Accounting | Append-only corrections and transaction/payment history. | Monthly checklist and immutable report snapshot, controlled close/reopen; closed-period financial changes require reopening with a reason. |
| Shopping | Click-to-add, Buy Again, tab/credit controls, install guidance. | Existing quick shopping is preserved. Round 8 conveniences are deferred. |
| Engagement | Moderated requests/reviews and trial feedback. No rewards/badges. | Rewards Admin owns rules, tiers, points and badge issue/revoke history. Members control profile visibility, displayed badges and board participation. |

## Defaults and boundaries

- Guest ordering starts closed. Codes are generated securely, hashed, expiring and revocable. Guest sessions are signed and host-only. Guests cannot use member credit or tabs.
- Guests report an immediate cash/Cash App payment. Only an admin can confirm receipt. Pending stock reservations expire; paid orders never expire automatically. Pickup is free; US shipping is enabled only for explicitly configured campaign items.
- Rewards start at deployment; no historical awards, balances or orders are rewritten. Admin recognition can cover past contributions with a recorded reason. Murley Bucks reward capped participation, not dollars spent.
- Profiles and the Support Board are opt-in. Aliases/images are moderated. No purchase amounts, balances or itemized activity are shown there. The editable first rank title defaults to “Snack Dump Chief.”
- Round 8 is explicitly deferred. No UPC, shelf-link, or offline feature is added in this patch.
- Main authentication, current-session admin MFA, shop isolation, tab caps, member-selected credit and existing payment/refund rules remain enforced.

## Data, deployment and rollback

Use additive GUEST-SCHEMA.sql, AUTOPILOT-SCHEMA.sql and REWARDS-SCHEMA.sql migrations after existing schemas. Preserve existing records and IDs. The guest Worker shares the established database and images but has no member/admin routes or framework handler. Keep the guest storefront closed until its signing secret and custom domain are configured.

Test repeat migrations, authorization, closed/rotated/expired codes, ownership, server-side prices, shipping math, concurrent last-stock orders, expiry versus payment confirmation, refunds, period locks, points caps/idempotency/reversal, badge expiry/revocation, profile moderation, image sanitization and opt-in privacy. Test both Workers in workerd and both themes on mobile/desktop.

Rollback code without dropping the additive tables. Keep guest ordering closed during a guest-only rollback. Do not revert business data or remove ledger/audit records.
