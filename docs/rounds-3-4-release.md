# Identity, admin tasks, and community purchasing

Baseline: main 65eb1279b18c368851b11e2a20fded1ec7b1a316 (PR13).

## Workflow audit

| Current friction | Authoritative workflow in this patch |
| --- | --- |
| Account email cannot change safely. | Account request → new-address verification → admin review → recorded Access-policy checklist → atomic identity change. Existing member ID remains authoritative. |
| Pending work is spread across payments, member management, team notes and reports. | Needs attention aggregates those source records; assignments, notes and history attach to stable source keys. Actions link to their existing write surface. |
| Requests end at accepted/denied. | Request → linked draft product → timed trial or interest check → reviewed decision/preorder. Shared product fields continue to use the snack/gear editors. |
| New balances have no layout; dashboard cards hard-code white. | Shared spacing and semantic surfaces in both themes. |

## Compatibility and safeguards

Additive schema only. Do not reseed or alter current stock, balances, members, orders, or payments. Verification codes are hashed, expiring and attempt-limited; changing email requires the account password, verified new address and admin approval. External Access synchronization uses a recorded manual checklist; no Cloudflare management token is added to the Worker. Owner address changes remain a separate configuration operation to avoid ownership lockout.

The task queue derives current truth from source records; resolving a task cannot confirm payment, remove debt, grant access or fulfill gear. Source resolution stays in the existing authorized transaction. Task annotations retain history.

Community features retain shop isolation, verified-purchase eligibility and posting restrictions. Interest does not reserve stock, create debt or place an order. Preorder conversion uses the existing gear editor and payment workflow. Trial reports use actual effective sales, refunds, recorded costs and verified feedback; no forecast is presented as revenue.

## Deployment and rollback

Apply repeatable ROUNDS-SCHEMA.sql before uploading the Worker, after security preflight. Older builds ignore the added tables. Roll back the Worker without dropping tables or reverting business data. Test migration twice against representative current records.

## Where to find the new controls

- **Manage → Needs attention**: source-linked queue, search, open/resolved/mine filters, assignment, follow-up dates, notes and reminder history. Payment confirmation and balance changes stay in their existing protected controls.
- **My account → Sign-in email**: current-password request and new-address verification. **Manage → Members → Change email** permits an authorized admin to initiate a request for a member.
- **Manage → Email access**: issue a one-time code for manual delivery to the requested address, review verification, record the applicable Cloudflare Access changes, then complete. No automatic email service or Cloudflare write credential is required.
- **Requests → Create trial / interest check**: create one linked draft; configure it in the normal product editor. **Manage → Trials** opens activities, reviews results, records waste/shrink and sets a keep/end/preorder outcome. Members participate through **Requests**.

## Validation

- Repeatable additive migration preserves member IDs, balances and existing purchase associations.
- 61 focused email, source-task, trial, demand, permission and preservation checks.
- 38 compiled-Worker checks cover gear editing plus the new routes, current-session MFA, cross-origin/body restrictions, email session revocation and concurrent conversion/completion.
- Existing suites: 70 financial/inventory checks, 63 beta checks, 48 gear/checkout checks, 28 UI/theme contracts, 8 HTTP-body checks, 96 authentication checks, 60 security/concurrency checks, 589 hardening checks, 47 provider-preflight checks, 4 image-parser and 4 backup-integrity checks.
- TypeScript and production build pass. Dependency audit reports no known vulnerabilities.
- Browser walkthrough uses a separate static Sites replica with disposable sample data: desktop and 390 px iframe viewport, both themes, tab/credit spacing, dashboard cards, task note/assignment, request conversion, trial metrics and gear-only navigation. This replica cannot verify production identity-provider behavior; actual Worker tests cover authorization separately.
- D1-compatible task projections use small compound views. Activity reports are paginated to keep individual requests within the Free-plan query budget. Unknown costs remain explicitly unknown.

No production records are seeded or reset by this release. Human steps remain deliberate: sending the new-address verification email, updating applicable Access policies, and deciding whether to keep a trial or open preorders.
