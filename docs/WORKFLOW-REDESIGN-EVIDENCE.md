# Workflow redesign — implementation and verification

## Authority and release lineage

The owner explicitly authorized the September 21 workflow brief, isolated end-to-end tests,
and deployment for existing members when checks pass. New members must receive Google
preauthorization; the active whitelist remains authoritative. No invitations or messages
are sent by this task.

Starting commit: 685a1949bdaabac0a1caea22fc66b6702c32e185 on
codex/identity-team-test-2026-09-21. Implementation branch:
codex/workflow-redesign-2026-09-21. The deployed code 79102ba79f64ff4dc230a8dd424d2ec5103eec09
and merged PR18 14118f95e115145b1121e5d1aa0d231e616471d4 are ancestors.
No repository AGENTS.md was present. The baseline Worker version was
fac5a1d1-e61b-4bdf-9568-3b65c338c976, at 100% in deployment
1bf62b43-27bb-4eba-ac14-d4e45828e609. Runtime readback confirmed this baseline.

## Implemented outcomes

- **Members:** Snack bar, My account, More; Gear, Recognition, Requests and Help remain
  reachable under More. Public information has a large Sign in action and preserves the
  OAuth app name and privacy disclosures. Existing guest isolation and checkout remain.
- **Management:** Overview, Products, Restock, Money, Members, with remaining tools in
  More tools. Members open account/access/activity details. Roster readiness is filtered
  and paginated on the server. CSV preview, final approval and results use readable cards,
  preserve selected rows/drafts, and retain the existing fresh-proof and invitation flow.
- **New members:** manual creation and create-mode CSV imports atomically issue a one-use,
  90-day, member/epoch-bound Google reservation for the primary address unless the CSV
  explicitly supplies another address. Existing-member updates still require explicit
  authority. Google must prove Gmail or managed Workspace ownership. Other Google-account
  addresses need an invitation; arbitrary email similarity never links accounts. Disabled
  members cannot register. Containment/reactivation invalidates old authority and requires
  a new reservation, as explained in import warnings.
- **Products:** name, image, selling price, explicit tax, publication, opening inventory
  and supplier/pack defaults can be saved together. Prices round up to a quarter. Metadata
  edits never reset live stock. Gear keeps its existing specialist editor.
- **Restock:** saved planning/shopping/purchased/completed stages; actual packs/prices,
  skips, added/substitute items, multiple receipts, paid-but-not-stocked goods, partial
  receiving and recorded returns/damage. Repeat uses current purchase options and stock
  needs. Up to 400 bounded lines are supported. Prices match product, variant, supplier
  and pack size; latest confirmed matching receipt takes precedence. Freshness defaults
  to 30 days and is configurable. Unknown cost/charges remain explicit. Shared charges
  and discounts are rechecked for actual receipt quantities.
- **Money:** immutable Cash/Cash App and extensible account observations; classified
  movements with effective and posting times; optional second checker; payment coverage;
  transfers; explicit commitments; personal reimbursement exception. One purchase expense
  links to one funding outflow or payable. Receiving and reimbursement do not repeat that
  expense. Paid amounts and held portions are removed from the remaining run projection.
  Credit provenance distinguishes reward, evidenced cash-backed minimum, and unknown.
- **Reporting:** complete paginated receipt/run/account history and formula-safe CSV;
  effective-date annual movement reports retain posting dates. Funds, tabs, investments,
  inventory value, known-cost margin and missing-cost coverage are distinct. Historical
  cost corrections require evidence and preserve original sale snapshots. Closed money
  reports are retained with existing immutable accounting snapshots. No historical balance,
  average, fixed reserve or compliance determination is invented.

## Requirement matrix

| Requirement | Result and code/test evidence |
| --- | --- |
| D-01 | Implemented: pilot navigation, admin-navigation.tsx, browser More/Gear checks; rewards/guest/permissions regressions pass. |
| D-02 | Implemented: purchasing.ts and money.ts; activity account explicitly selected; payable/settlement tests prove no second expense. |
| D-03 | Implemented: purchase-math.ts, shared purchase options and run snapshots; exact example, matching/stale/missing inputs, remaining forecast tested. |
| WP-0 | Complete: baseline/ancestry inspection and original-record snapshots before edits. |
| WP-1 | Implemented: identity member tabs, server readiness pagination, compact imports and preserved authority; import and browser suites. |
| WP-2 | Implemented: atomic product editor, shared purchasing data, direct/run receipts and cost coverage; workflow and HTTP suites. |
| WP-3 | Implemented: restock-workspace.tsx, purchasing.ts; lifecycle, 48-item atomic receipt, partial receiving, corrections, retry and export checks. |
| WP-4 | Implemented: money-workspace.tsx, money.ts, month report; observations, coverage, funding, commitments and aggregate reporting checks. |
| WP-5 | Local verification, protected recovery, exact-candidate Linux CI and deployment passed; release details and live preservation evidence are recorded below. |
| E-01 | Atomic creation/publication and checkout through real compiled API; rounded price, one product, retry-safe stock. Browser creation also exercised. |
| E-02 | Shared defaults, matching receipt precedence, immutable snapshots, direct and run analytics tested in workflow.mjs and compiled routes. |
| E-03 | 83 units, 10936 merchandise cents, 11400 with charges, 11150 after the changed pack price — exact assertions pass. |
| E-04 | Missing/stale prices, supplier/pack mismatch and unknown fees do not create unsupported all-in totals. |
| E-05 | One purchase outflow; later/partial receiving and concurrent receivers change stock once. |
| E-06 | Personal payable, partial/final settlement and return offsets tested; one purchase expense. |
| E-07 | Legacy count imported once; checks never alter member balances; already-counted payment confirmation does not add money twice. |
| E-08 | Atomic IDs/version guards; lost-response/reload retry, expired-session refusal/renewal, saved drafts, concurrent stock/financial changes tested. |
| E-09 | Existing import/invitation/recovery suites retained, including expiry/revocation/reissue and immutable member binding. New grants add no old-account authority. |
| E-10 | More navigation tested in browser; existing guest, reward, raffle, opt-out, permissions and commerce suites pass. |
| E-11 | Pagination beyond one screen, effective-date exports, legacy receipt/run markers, source IDs and CSV formula escaping tested. |
| E-12 | Typecheck and application/gear builds pass. Repeated synthetic and protected-real-backup migration preserves all original records; details below. |

## Verification performed

Commands below run from the repository. On this Windows host pnpm was invoked with Node
using the bundled pnpm/bin/pnpm.cjs; the commands have identical project scripts.

- pnpm run typecheck; pnpm run build; pnpm run build:gear — passed. Gear is dry-run only.
- node tests/workflow.mjs — 71 isolated SQLite assertions, including original-row equality,
  financial concurrency, a 48-item receipt, effective-date export and repeated migration.
- node tests/workflow-http.mjs — 61 assertions against the actual compiled Worker with disposable D1/R2, signed
  synthetic Access, CSRF/host isolation, receipt retry/concurrent receiving and member creation.
- WORKFLOW_BROWSER_CHANNEL=msedge node tests/workflow-browser.mjs — real compiled application
  in Chromium/Edge 153.0.4234.48, disposable data; 43 browser assertions pass. Screenshots and counts are in ignored
  .sites-runtime/workflow-browser/evidence.json. CI runs the same test with pinned Playwright
  1.62.1 Chromium. No production API responses or provider sign-ins are mocked into the app.
- node tests/auth-containment.mjs (24), identity.mjs (62), member-import.mjs (162),
  identity-protocols.mjs (74), identity-edge-cases.mjs (26), identity-release.mjs (37).
- node tests/pilot.mjs (74), beta.mjs (63), rounds-1-2.mjs (48), rounds-3-4.mjs (61),
  rounds-5-7.mjs (86), earning.mjs (77), redemptions.mjs, profiles-experience.mjs,
  admin-experience.mjs (80), payment-handoff.mjs, rewards-ui.mjs (30), ui-contracts.mjs (28).
- node tests/http-security.mjs (8), identity-http.mjs (116), shared-nat.mjs
  (60 successful concurrent member requests), experience-http.mjs (104), rounds-http.mjs (38),
  roadmap-http.mjs (61), auth-integration.mjs (96), security.mjs (62; no findings),
  hardening.mjs (589 plus 47 provider checks), image-parsers.mjs (4), backup.mjs — passed.
- pnpm audit --audit-level high — no known vulnerabilities.

Windows esbuild-based commands required ordinary local runtime access outside the sandbox;
rerunning those checks with that access passed. A local workerd shutdown emitted a Windows
socket-close diagnostic after the identity HTTP assertions; the test completed successfully.

Browser screenshots were visually inspected at 320, 390, 430 and desktop widths, light/dark
and enlarged text. Fixed issues included stale untouched line drafts, selector labels,
mobile nested panel density, sticky controls over navigation, enlarged-text header overflow,
minute-rounded financial timestamps, and background session-expiry navigation. Screenshots
are synthetic local evidence, not physical iPhone/Android testing. No new provider test is
claimed here. Earlier owner-confirmed Google/Microsoft/iPhone/MFA-denial results are retained;
Android, desktop passkey and the second administrator's mapping remain the earlier pending
full-cutover checks. The authorized active-whitelist member beta remains enabled.

## Migration and recovery

Apply only WORKFLOW-SCHEMA.sql after the existing deployed schemas. It adds companion tables,
views, immutable-record triggers and source-unique payment movements. Existing cash-count audit
records become observations once; verified external payments retain uncertain historical arrival
time. No old pack prices, supplier details, account balances or member authority are inferred.

The protected backup database-pre-workflow-2026-09-21.encrypted was created from two identical
consecutive full D1 exports. At 2026-09-22T00:55:58.456Z its isolated restore reconciled all
102 application tables, 10 views, all member/balance digests, 21 private images and 21 image
references. Applying the workflow migration twice preserved every prior table/view and passed
foreign-key checks. No production data or keys are included in this repository.

The stale-identity recovery drill also passed with synthetic credential/session/flow canaries
inside that restored memory copy. The checker now freezes time and explicitly proves that
containment changes only the active flag on derived tab reminders; every other reminder field
and all business tables remain checked. A new overdue-member regression covers this case.
This is an assertion correction, not removal of the preservation or containment gates.

Deployment order: exact-candidate CI → fresh protected backup/rehearsal → additive migration →
second protected export and invariant comparison → prepared member-beta configuration → dry run
→ exact Worker deploy → route/binding/version readback and read-only smoke checks.
Use scripts/prepare-identity-release.mjs on the approved release branch. Preserve all current
secrets, D1/R2 bindings, hosts, Access policies, disabled alternate URLs and paused automatic
builds. Google fresh proof remains disabled until its separate provider requirement is met.

If code deployment fails after migration, the old release can still read the original tables.
Retry the checked code deployment; keep additive records. After new workflow transactions exist,
prefer forward repair. If code rollback becomes necessary, stop restock/money management writes
while assessing compatibility: the older management UI does not understand new run companions.
Never restore an older database merely to roll back code, delete receipt history, replay an
initial seed, or assume a rollback undoes member purchases. Protected restore/cutover requires
reconciliation and re-verification of authority, as in the established recovery documentation.

## Five mobile owner checks

1. Sign in as a normal approved member. Open More → Gear and Recognition; return to Snack bar.
2. In Products, add a real needed item with price, explicit tax and pack defaults; publish once.
3. Plan a real restock, edit actual quantities, refresh, then finish the actual receipt with the
   account used. Record stock later if it is not on the shelf; check receipt history and funds.
4. In Money, enter actual Cash/Cash App balances, time and reviewer if present. Confirm an already
   included payment only after identifying it; verify the balance is not increased twice.
5. In Members, open the intended member's account/access/activity. Preview a CSV, inspect issues,
   then perform fresh verification only for intended selected rows. Check Google readiness.

These owner checks are live testing guidance, not a claim that fictitious production purchases
or balance observations were created.

## Deployed workflow release — September 21, 2026

PR [#19](https://github.com/Fakearroyo1/IYAAYASFW/pull/19) was integrated by fast-forward into
codex/identity-team-test-2026-09-21, preserving the exact tested commit and PR18 lineage.

- Deployed code: 420a969699d7ff9cd1d8723117bdb3447ca94dc9.
- [Linux CI 35675124832](https://github.com/Fakearroyo1/IYAAYASFW/actions/runs/35675124832):
  all application, dependency-audit and secret-scan jobs succeeded. The real compiled browser
  suite passed 43 assertions in Chromium 151.0.7922.34, alongside 71 workflow and 61 HTTP checks.
- Worker version: ae041431-60b8-4b4c-a55b-dbcf516e463c, version number 40.
- Deployment: 2c03c0ea-f7e7-4c21-a912-d4bc821fbe48, 100%, 2026-09-22T01:27:46.97251Z
  (September 21 at 9:27 PM Eastern).
- Prepared configuration SHA256: a7a8dfcc565864a573492df795318169e90bcd19d74db3b5b21c835b68297786.
  Existing observability and logpush values were copied exactly before the successful dry run.

The final pre-migration encrypted backup captured 102 tables and 10 views in two identical
exports at 01:17 UTC. Its isolated restore, image reconciliation, repeated workflow migration
and stale-identity containment rehearsal passed at 01:17:54.416 UTC. Owner vault retrieval
evidence was retained from the previously completed real recovery exercise.

Only WORKFLOW-SCHEMA.sql was applied remotely with the installed Wrangler 4.92.0:
`wrangler d1 execute iyaayasfw-supply-db --remote --config .sites-runtime/workflow-migration.json --file WORKFLOW-SCHEMA.sql --yes --json`.
It executed 54 statements successfully, adding 18 tables and one view; it did not replay any
seed or identity migration. Canonical LF SQL SHA256:
7306969ea64a56d289b21cf90ab206dc89836cfee92599b6f0eb19f0a2b1ea79.
Windows checkout-byte SHA256: 5933625446bbb5f89a89634c8abd0220879aa23b3814d43d4ad30a8d88ceea97.

Both the migrated and deployed encrypted snapshots restored successfully with 120 tables,
11 views, no foreign-key violations, 21 images and 21 image references. Independent comparisons
checked all 112 original table/view objects across migration and all 131 across deployment.
Members, balances, stock, transactions, permissions, rewards and business history matched.
All 17 original unexpired sessions remained unchanged. No credential was added, removed,
reassigned or changed apart from a last-used timestamp during independently observed sign-ins.

The site remained in use. Strict full-table comparison correctly stopped on a Google sign-in
at 01:19 UTC before migration, and two passkey sign-ins at 01:27 and 01:29 UTC around deployment.
Field-level reconciliation verified the exact additions, their recorded times, unchanged
original rows and credential material, and only last-used timestamp changes. Sign-outs and
pending login flows were retained. No generic identity-table exclusion was added to the
repository recovery checks. The ignored private evidence files are workflow-migration-preservation.json
and workflow-deployment-preservation.json under .sites-runtime/audit.

Release preparation used `prepare-identity-release.mjs` with member-beta and the exact passing
commit, fresh Cloudflare reads, current active roster, verified owner mapping and protected
recovery evidence. After dry run, deployment verified clean HEAD and the configuration checksum,
then used `wrangler deploy --config dist/server/identity-release.json --keep-vars --tag
420a969699d7ff9cd1d8723117bdb3447ca94dc9` with the PR19 release message.

Readback at 01:29:31 UTC verified the commit tag, version, 100% deployment, all 25 bindings,
all five existing domains, private storage, unchanged logging and disabled Worker preview URLs.
Fourteen anonymous live route checks passed: public home/about/privacy, unauthenticated API
denial, Cloudflare Access management protection, auth/register API isolation, and enabled
Google/Microsoft/passkey member-beta state. A live 390px browser check also confirmed the
320×62px sign-in button, no horizontal overflow, no page errors and no failed script assets.

Existing and future active whitelisted members can use this release without another beta
unlock. Manual and CSV-created members receive Google reservations automatically; only a
verified matching Google-authoritative address can consume one. This does not open public
registration or convert a non-authoritative third-party Google email into proof.

The previously pending Android, desktop, second-administrator mapping and final cutover
acceptance remain pending. The release stays member-beta, preserves the unmapped administrator's
existing MFA path, and leaves Google fresh account-change proof disabled. This workflow
deployment does not claim completion of those independent identity cutover tests.

## Mobile management navigation correction

The owner reported that the expanded More tools menu was clipped on mobile. The inherited
management navigation scroll container clipped its absolutely positioned dropdown. The menu
now expands in document flow, uses responsive grouped columns and returns keyboard focus to
its summary after selecting a destination. It has no inner scrolling or offscreen anchoring.

The new browser regression first failed against the deployed build, measuring the menu bottom
at 1009px outside a navigation panel ending at 441px. With the fix, 136 compiled-route browser
assertions pass at 320/390/430/1280px, light/dark and 200% zoom. These now open the menu, verify
that its content fits inside the panel, select every secondary tool, verify the selected page,
and check focus restoration. Application build and typecheck pass. This correction has no
database or identity changes; its deployment is recorded below after candidate CI.
