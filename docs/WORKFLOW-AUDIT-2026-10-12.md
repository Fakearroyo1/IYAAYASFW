# Member support and workflow audit — October 12, 2026

## Purpose and architecture

The owner requested working password recovery, faster payment/member support triage,
stable mobile member management, and a complete audit of the existing workflows.
The existing design remains an unattended, phone-first unit snack bar with manual cash
and Cash App confirmation, whitelisted membership, Google preauthorization for new
members, persistent sign-in, and a separate public gear store. This change uses the
existing Worker routes, D1 transactions, authorization checks, operation identifiers,
and ledger rules. It adds no schema, payment processor, automatic email delivery,
member migration, or monetary-policy change.

Baseline: source commit `c53ac19`, production code `62f7a87`, Worker version
`32568463-d143-46f0-844c-4ae8e73fd39f`. Production business records are used only for
read-only diagnosis and the explicitly approved encrypted recovery backup. Workflow
writes and purchases are exercised in disposable synthetic SQLite/D1/R2 fixtures.

## Problems found and completed improvements

| Finding | Implemented journey, from start to finish |
| --- | --- |
| Reset requests led into member management without an obvious recovery action. | Member selects Forgot password → one durable request → admin sees Issue recovery code on the dashboard or task row → known-contact identity check → one-hour private code and member-host recovery link → member saves a new password → old sessions and code are invalidated → request resolves automatically. Replacement invalidates the previous code. Issuance alone leaves the request open. |
| The dashboard required opening multiple lists before acting on reported payments. | Member completes checkout or reports a tab payment → payment appears with member, amount, reference and time → Confirm payment opens its exact confirmation form → admin checks the actual receipt → existing transaction applies once → balance/ledger/rewards update → task disappears. Automatic refresh runs every 30 seconds and on focus; action completion also refreshes the dashboard. |
| Open tasks exposed team metadata before the action needed to resolve the source. | Admin opens Needs attention → chooses Payments, Member support, Orders, or All → searches if needed → selects the row’s named action → exact source record opens → admin completes the source workflow → task updates. Assignment, snooze and notes are under Details / Filters & team tools. Workflow metadata cannot dismiss a real financial/access obligation. |
| Selecting a member expanded the page and lost the mobile working position. | Admin searches the roster → results refresh after typing → selects a member → bounded dialog with Account, Sign-in & access, Activity → opens account editor or recovery action → returns to the same member → closes to the original roster position, search and focus. The roster has its own bounded scroll area. Buttons wrap at narrow widths. |
| Older task targets were outside first-page limits; gear targets could open a snack list. | Task identifiers now select the exact email request, item request, trial, team thread, moderation report, pickup order or member independently of pagination. Shop context comes from the targeted record. Every query retains its existing member/admin/shop authorization. Missing targets show an empty result instead of an unrelated record. |
| Opening a second task’s Details could briefly show the previous task. | The details panel displays a task only when its key matches the current selection; it shows Loading until the correct response arrives. Stale request responses are discarded. |
| Accounts using Google/Microsoft/passkeys without a password saw an unusable current-password email-change form. | My account checks whether the password-verified flow is available. Password accounts can initiate it. Accounts without a password get a store-team contact route; the administrator starts the existing new-address verification, review and Access-policy completion process from member management. Existing reauthentication requirements remain enforced. |
| Reset snoozes and bulk edits did not account for recovery-code issuance. | Recovery expiry is included in the source revision. Issuing/replacing a code restores the reminder and invalidates stale bulk actions. An expired code leaves the request actionable. No password hash or raw recovery code is included in task responses. |

## Workflow coverage and completion checks

The following are completed isolated workflows, including denial, retry, expiry or
reversal paths where applicable. “Browser” means actual compiled pages interacting
with the disposable Worker; “HTTP” means compiled Worker routes; “SQLite” verifies
transactional state and preservation directly. These labels are evidence boundaries,
not claims that every flow was exercised with live members or physical devices.

| Process | Start → completion and important checks | Evidence |
| --- | --- | --- |
| Member sign-in and password recovery | Sign in / request reset → verified issuance → code replacement/use → password saved → prior sessions revoked; duplicate request, unknown/inactive account, one-use and expiration denial. | `workflow-audit-browser`, `workflow-audit-http`, `auth-integration`, `identity-http`, `auth-containment` |
| Google/Microsoft/passkey identity and enrollment | Explicit member-bound grant → authenticated provider/ceremony → association → host-bound handoff → member session; subject mismatch, callback replay, origin/UV/nonce/PKCE, stale grants and revocation denied. | `identity`, `identity-protocols`, `identity-edge-cases`, `member-import`, `identity-http`, `shared-nat` |
| Admin access | Access identity and MFA → mapped app principal → administrator session → authorized action; member, wrong audience/host, stale authority and unauthorized administrator changes denied. | `identity-http`, `identity-protocols`, `auth-integration`, `hardening` |
| Members, imports and invitations | Search/paginate → exact account → permissions or contact changes → save → return; CSV preview/approve/result, invitation replacement/expiry, Google preauthorization, owner protection and disable/re-enable containment. | `workflow-audit-browser`, `workflow-audit-http`, `member-import`, `workflow`, `identity` |
| Sign-in email | Password-authorized or admin-created request → new-address code → member verification → review → applicable Access policy checklist → completion and session revocation; cancellation/rejection/version races retain guards. | `experience-http`, `rounds-http`, `workflow`, `workflow-audit-http` |
| Snack checkout | Catalog → bag → tab/payment choice → confirmed order/receipt → inventory and balance update exactly once; stale stock, duplicate/lost response and concurrent purchases. | `workflow-browser`, `workflow-audit-browser`, `pilot`, `beta`, `security`, `hardening` |
| Member gear and pickup | Product/options/personalization → pending purchase → verified payment → stock receipt/readiness → pickup completion; wrong shop, missing option, unpaid pickup and shared-stock races denied. | `rounds-1-2`, `rounds-3-4`, `rounds-5-7`, `rounds-http`, `roadmap-http`, `workflow-audit-http` |
| Guest gear | Campaign/code → audience-isolated bag → order/payment → fulfillment; code rotation/expiry, duplicate requests, partial/full refunds including shipping and expiry/payment races. | `rounds-5-7`, `roadmap-http`, `auth-integration`, `hardening` |
| Payments, tab and credit | Member report → actual-receipt confirmation → ledger allocation/rewards → source task removal; duplicate confirmation, overpayment, mixed credit and concurrent writes preserve accounting. | `workflow-audit-browser`, `pilot`, `beta`, `earning`, `payment-handoff`, `security` |
| Transactions and corrections | Find original transaction → supported reasoned correction/refund/write-off → immutable history and correct stock/credit/rewards; forged records and consuming forgiven debt denied. | `pilot`, `rounds-3-4`, `rounds-5-7`, `earning`, `redemptions`, `roadmap-http` |
| Products/options/images and pricing | Create/edit → stock and option allocation → sanitized image → explicit price/cost application → future sales snapshots; archive and past-order preservation. | `rounds-1-2`, `rounds-3-4`, `rounds-5-7`, `workflow`, `image-parsers`, `roadmap-http` |
| Restock and counts | Plan/list/run → calculate actual purchase → partial/full receipt → costs/stock → reconciled view; retry after lost response, stale inputs/counts and purchase/receipt races. | `workflow-browser`, `workflow-http`, `workflow`, `rounds-5-7`, `roadmap-http` |
| Month close/reopen and CSV | Reconcile checkpoints → actual cash/Cash App evidence → immutable close report/export → reasoned reopen history; pending payments and closed-period writes guarded. | `workflow-browser`, `rounds-5-7`, `roadmap-http`, `hardening` |
| Item requests/reviews/moderation | Submit → vote/comment/review → exact admin decision/report → resolved task; purchase eligibility, visibility, shop and posting permission enforced. | `rounds-3-4`, `experience-http`, `workflow-audit-http`, `hardening` |
| Trials and interest/preorders | Request → linked draft → open activity → feedback/interest → explicit decision/preorder/loss → source resolution; exact gear activity preserves shop context. | `rounds-3-4`, `experience-http`, `workflow-audit-http` |
| Team questions and task metadata | Question → exact thread/reply → resolution; private assignment/notes/snooze/bulk → stale skips and source-protected completion. | `experience-http`, `admin-experience`, `workflow-audit-http` |
| Rewards/redemptions/seasons | Eligible paid activity → recorded award → member balance → redemption/claim or correction → stable history; funding provenance, caps, reversal and no-backfill rules. | `earning`, `redemptions`, `rounds-5-7`, `roadmap-http`, `rewards-ui` |
| Profiles and profile reports | Edit visibility/photo → bounded sanitized upload → admin approval/report decision → correct public visibility; opt-outs and unlock checks. | `profiles-experience`, `rounds-5-7`, `roadmap-http`, `image-parsers` |
| Mobile navigation, themes and installation | Store/admin navigation → target workspace → working dialog → return, at 320/390/430/1280px, light/dark and 200% zoom. | `workflow-browser`, `workflow-audit-browser`, `ui-contracts`, `rounds-1-2` |
| Settings, exports and recovery | Authorized setting/export → validated result; repeated additive schemas preserve originals; authenticated encrypted backup → in-memory restore → stale identity containment. | `pilot`, `beta`, `hardening`, `shop-migration`, `backup`, private recovery verification |

## Security maintenance

The registry audit discovered newer high/critical advisories in the locked dependency
set. The release pins Next/eslint-config-next 16.3.8, sharp 0.35.5, undici 7.29.1,
brace-expansion 1.1.20/5.0.11 and source-map-js 1.2.2. Wrangler and the architecture
remain unchanged. Installation-age exceptions name only exact reviewed package versions.

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no upstream
braces patch. `patches/braces@3.0.3.patch` bounds parser nesting and validates AST depth,
node count and cycles before recursive compile/expand/stringify operations. pnpm pins
the patch checksum. `tests/dependency-guards.mjs` exercises ordinary patterns plus
deep patterns, forged deep ASTs and cycles through both affected build/lint dependency
paths. CI runs these checks before recognizing only this locally remediated advisory
in the registry audit. Other high/critical advisories still fail the release gate.

## Verification and release record

Run the main build and gear dry run, then:

```text
node scripts/verify-workflows.mjs unit
node scripts/verify-workflows.mjs http
node scripts/verify-workflows.mjs browser
```

Windows browser verification uses Edge via `WORKFLOW_BROWSER_CHANNEL=msedge`; Linux CI
uses Playwright Chromium. Safe result summaries and synthetic screenshots are retained
under ignored `.sites-runtime/workflow-audit`, `workflow-browser` and
`workflow-audit-browser`. Security CI includes the new HTTP/browser audits.

On October 12, the owner explicitly approved an encrypted production backup after
automatic approval review initially rejected an unspecified full export for its
sensitive member/operational contents. Two exports matched across 120 tables and
11 views. Only encrypted backup bytes were retained locally; restore and stale-identity
rehearsal passed in memory at 03:15:49 UTC. No production restore or schema operation
was performed. Private export URLs, keys, codes and member records stay out of Git.

Local checks passed: 24 unit/preservation suites (including the corrected 74-check
workflow suite), 10 compiled HTTP suites (including 70 task-target checks), 139 existing
browser checks and 41 recovery/payment/member-dialog browser checks. The final main
build, gear dry run and typecheck passed. All 813 installed packages had verified
registry signatures. The dependency gate passed with three moderate upstream
advisories remaining and the one locally patched high advisory recorded explicitly.

The deployed source is `1a2356b45ef4e7f2a3ecbcb08769f3ba9fe767e4`. Its
[Linux CI run 38200028583](https://github.com/Fakearroyo1/IYAAYASFW/actions/runs/38200028583)
passed application tests, dependency audit and the full-history secret scan.
[PR 21](https://github.com/Fakearroyo1/IYAAYASFW/pull/21) targets the existing
production identity branch, `codex/identity-team-test-2026-09-21`; the historical
`main` branch and paused automatic deployments remain unchanged.

Publication completed at 03:42:43 UTC on October 12. Deployment
`ab1517fb-cdc3-4410-bc56-560c8230aa4b` serves 100% Worker version
`21de24ae-15da-4fcb-b14d-ff0cfc7dc663`. API readback confirmed the source tag,
all 25 bindings, runtime flags/date, limits and observability. Settings changed only
in release annotations. Domains, both Access applications and policies, MFA,
Turnstile configuration, private R2 access, disabled Worker preview URLs and paused
build triggers matched the pre-release snapshot. The separate gear Worker was not
deployed. The prior Worker version remains available for code rollback.

The post-release read-only comparison at 03:47:42 UTC found no changes in member and
active-member counts, total debt/credit, product count/stock, order count/total,
payment count/total/pending count, or money-movement count/total. The reported reset
remained pending with no recovery code issued. This is an aggregate preservation
check; the approved pre-release restore verified the complete table/view manifests.
No production schema, restore, purchase, payment or account change was performed.

Live checks completed at 03:51:02 UTC: the storefront, recovery page, About, Privacy
and gear storefront returned 200; all 32 deployed static assets matched the packaged
bytes and sizes; anonymous member/task/member-list APIs returned 401; the admin host
redirected to the existing Cloudflare Access team. Edge at 320px and 390px displayed
the recovery inputs and save action with no horizontal overflow, client page errors
or failed app assets. The recovery mode is activated by client hydration. No live
forms were submitted. Turnstile completion and member/admin transactions were
exercised in the isolated end-to-end suites, not through a live member account.

Safe publication and live-smoke summaries are retained under ignored
`.sites-runtime/audit/workflow-audit-publication.json` and
`.sites-runtime/audit/workflow-audit-live-smoke.json`. No private backup material is
included in these summaries or the pull request.

## Evidence limits

Real Google/Microsoft service sign-in, physical iPhone/Android passkeys, cash receipt
verification and communicating private codes depend on the account owner/member.
Existing accepted member-beta identity evidence is retained; this audit does not claim
fresh provider or physical-device acceptance. Browser tests use synthetic Access and
Turnstile services and real compiled app transactions in disposable databases. The
real reported password-reset request remains pending until the administrator verifies
the member and the member completes recovery.
