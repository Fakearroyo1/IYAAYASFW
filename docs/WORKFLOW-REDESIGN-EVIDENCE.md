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
| WP-5 | Local verification and protected recovery passed; exact-candidate Linux CI and deployment recorded in the release addendum below when completed. |
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
or balance observations were created. Deployment commit/version and live readback follow in a
separate release addendum once the exact-candidate gates complete.
