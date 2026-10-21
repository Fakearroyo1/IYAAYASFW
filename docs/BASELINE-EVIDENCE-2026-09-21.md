# Baseline evidence — 2026-09-21

This record supports [the baseline](BASELINE-2026-09-21.md) at commit `3357cad7bfe8e7ae50475718e8542e9fba83933f`. Observations were made September 21 UTC. Findings are time-limited. No raw credentials, provider tokens, private member records or exported database contents are included.

## Source and status discipline

Operative source: `IYAAYASFW-Codex-Handoff-2026-09-21.zip`, specifically its README, `prompts/FIRST-TASK.md`, `AGENTS.md`, authority/decisions/design/data/admin/migration/acceptance documents and baseline/work-order templates. The package was extracted alongside the cloned repository, leaving its contents unchanged. The earlier access-review document is supporting context. Competing historical source instructions are not adopted.

The repository README describes the current application, not approval for additional work. No application `AGENTS.md` was found in the checkout or inspected remote branches. No handoff reference schema was installed. D-01, D-02 and D-03 remain accepted product decisions; all D-04–D-18 defaults remain proposals.

`FEATURE-REGISTER.csv` preserves all 147 original feature IDs, names, source statuses/priorities/acceptance targets, classifications, treatment and decision dependencies. It updates evidence columns and appends `baseline_coverage`, `gaps_and_limits`, `inspected_commit`, `observation_date_utc`.

- `IMPLEMENTED`: recognizable current implementation with evidence; not a statement that every policy/production acceptance condition is met.
- `PARTIAL`: a related implementation exists but named criteria or evidence are missing.
- `NOT_IMPLEMENTED`: inspected source/configuration did not contain the target implementation.
- `EXCLUDED`: absence is consistent with the recorded exclusion/deferment; not a new owner decision.
- `UNKNOWN`: a real-world state such as physical QR deployment, performance or alert operation could not be established from source/configuration.
- Existing implementation vocabulary is retained. `INSPECTED_NOT_FOUND` is an explicit extension to distinguish inspected absence from `UNINSPECTED`. `TESTED` means the cited current implementation received some test coverage, not that the complete future feature passed acceptance. No row is `VERIFIED_IN_PRODUCTION` solely because a build deployed.

In test fields, `L:name` identifies a local passing `tests/name.mjs`; `CI:name` identifies an exact-SHA CI success. `L:dependency-audit` is the pnpm audit command, `CI:secret-scan` the Gitleaks job, `CI:all-three-jobs` the three workflow jobs. `L:13-suites,typecheck` refers to the complete local table below. CI includes the application suites also run locally, but repeated tags were avoided. A suite passing does not establish every edge case implied by a broad feature row.

## DEP-01 / DEP-02: deployed provenance

| Field | Main | Guest gear |
|---|---|---|
| Worker | `iyaayasfw-supply` | `iyaayasfw-gear` |
| Workers Build | `3ccda36e-430a-4dd8-8f3d-ce93c41a4c70` | `30520c7d-12a8-486d-8fba-df6d37b4d3b6` |
| Build branch / SHA | main / `3357cad7bfe8e7ae50475718e8542e9fba83933f` | Same |
| Build result | success | success |
| Log deployment evidence | `23:36:35 Current Version ID: 15562dc7-ca29-40f3-abb7-f2ed308d35cf` | `23:35:54 Current Version ID: 66bfd4ca-3af3-406f-ad36-870e1258eb9f` |
| Active deployment ID | `3a090da2-f744-4316-83ae-c5ba2fe13bf2` | `3a5b0ef9-ed3c-4b2a-aef0-d8fa255320d4` |
| Traffic allocation | 100% to matching version | 100% to matching version |
| Default/preview subdomains | Both disabled | Both disabled |

Read-only control-plane evidence included Worker list/settings/bindings, domains, deployments, version metadata, subdomain settings and Workers Builds details/logs. It confirms which build produced each active version. Runtime values can still differ from repository defaults; a deployed code path does not establish that rewards, raffles or guest ordering are currently activated.

Both Workers share the named production D1 and private R2 bucket. R2 managed public domain is disabled and custom domains list empty. Main live observability was `enabled:false`, nested logs enabled, traces disabled; gear observability enabled with traces sampled at 0.1. Both returned `redact_query_string:false`. Neither live logs nor their contents were downloaded.

## CFG-01: routing, Access and legacy Pages

Read-only API families inspected: Worker custom domains/routes/subdomains; zone DNS; Zero Trust Access applications/policies/identity providers/organization MFA; Pages project/deployments; R2 domain exposure. Values irrelevant to the audit, unrelated DNS/mail records, personal email allowlist values and raw secret data were excluded from documentation.

Cloudflare Access has a 30-minute self-hosted admin application on exactly `iyaayasfw.com/api/admin/access`; one explicit-email allow policy with independent MFA enabled for security keys/biometrics, Google selected. Organization MFA permits security keys/biometrics/TOTP. Returned representations did not include separate AMR fields. Existing preflight tests support this configuration representation. This is configured-policy evidence only; no factor challenge or failure path was exercised against production. Durable app-side principal mapping remains email-based plus per-session stored Access subject.

Legacy Pages project `iyaayasfw`:

- Production branch `main`; production and preview deployments enabled; preview include pattern `*`.
- Empty build command, build destination and root directory; no D1/R2/service bindings or environment variables returned for production/preview.
- Production deployment `62301df1-3b78-4cf3-81ad-7a679104fad5`, success from audited SHA, `2026-09-18T23:35:03Z`; endpoint `62301df1.iyaayasfw.pages.dev`.
- API reported 87 deployments. Only the latest five records and current production metadata were examined; every old deployment was not visited.
- Latest inspected branch preview: `f7515b6b-ae7b-4368-8c01-20f65b4da548`, with alias `dependabot-github-actions-ac-h3t0.iyaayasfw.pages.dev`. Reachability of every preview alias was not tested.
- No Pages protection application appeared in the returned two-app Access inventory. This is not an exhaustive edge/WAF-policy audit.

A private app and a public source repository are different boundaries. Confirmed static README publication is not evidence that Pages can read the production D1. Nevertheless, branch pushes have a public publication side effect and this project is not an isolated built-app preview.

## GH-01: CI and branch controls

[Security checks run 35406265564](https://github.com/Fakearroyo1/IYAAYASFW/actions/runs/35406265564), push to main, exact audited SHA, succeeded September 18. Jobs:

| Job | ID | Result |
|---|---|---|
| application-tests | `105796552254` | success; all configured step summaries successful |
| dependency-audit | `105796552264` | success, `pnpm audit --audit-level high` |
| secret-scan | `105796551964` | success, checksum-pinned Gitleaks 8.30.1, complete available history with redacted output |

`.github/workflows/security.yml` uses Ubuntu, Node 22 and pnpm 11.25.0. Application steps include typecheck; pilot, beta, rounds-1-2, rounds-3-4, rounds-5-7, earning, redemptions, profiles-experience, admin-experience, payment-handoff, rewards-ui, ui-contracts, http-security; main build; experience-http, rounds-http; gear dry run; roadmap-http, auth-integration, security, hardening, image-parsers and backup.

Main branch API returned `protected:true`, required contexts `application-tests`, `dependency-audit`, `secret-scan`, enforcement `non_admins`. Rulesets returned `[]`. Detailed branch protection returned HTTP 403 “Resource not accessible by integration.” Therefore independent review, stale-review dismissal, force-push/deletion rules and admin enforcement remain unverified. `infrastructure/main-protection.json` is a desired configuration file, not proof it has been applied.

## Local checks

All test scripts/bindings were inspected before execution: fixture suites use synthetic data and local SQLite; Workers HTTP/integration suites configure disposable local D1/R2. None of the executed commands invoked a deployment script, `d1 execute --remote`, production export, production load or a real-user operation. `.sites-runtime`, generated test files and dependencies are ignored; application and test source remained unchanged.

Actual environment: Windows PowerShell, Node 24.19.0, pnpm 11.25.0. The pnpm executable was the bundled runtime's `dependencies/node/node_modules/pnpm/bin/pnpm.cjs`; the audit invoked it through `node`. Reproduce the command form after resolving that installed path into `$pnpmCli`:

```powershell
node $pnpmCli install --frozen-lockfile
node node_modules/typescript/bin/tsc --noEmit
node $pnpmCli audit --audit-level high
node $pnpmCli run build
```

Results: frozen install passed, typecheck passed, audit **No known vulnerabilities found**. Build **failed before compilation** in `scripts/restore-assets.mjs:22`: using `URL.pathname` as a Windows filesystem path produced a duplicated drive prefix and percent-encoded spaces. No build/deployment success is inferred from that command. The original README's September 15 dependency advisory note is historical; it is not the current audit result.

The first unmodified `node tests/pilot.mjs` failed because Node rejects a drive-letter filesystem path as an ESM URL (`ERR_UNSUPPORTED_ESM_URL_SCHEME`, protocol `c:`). An ignored adapter `.sites-runtime/audit/windows-imports.mjs` registered a Node resolve hook converting drive-letter import specifiers with `pathToFileURL`. It changed path resolution only, not application behavior or assertions. Its full content was:

```javascript
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(/^[A-Za-z]:[\\/]/.test(specifier)
    ? pathToFileURL(specifier).href : specifier, context);
}});
```

Ten suites were run as `node --import ./.sites-runtime/audit/windows-imports.mjs tests/<name>.mjs`:

| Name | Local result |
|---|---|
| pilot | 70 checks passed |
| beta | 63 passed |
| rounds-1-2 | 48 passed |
| rounds-3-4 | 61 passed |
| rounds-5-7 | 86 passed |
| earning | 77 passed |
| redemptions | pass; no numeric count emitted |
| profiles-experience | pass; no numeric count emitted |
| admin-experience | 80 passed |
| http-security | 8 passed |

Three more suites ran directly:

```powershell
node tests/security-preflight.mjs
node tests/backup.mjs
node tests/shop-migration.mjs
```

They passed 47, 4 and 9 checks respectively. `shop-migration` uses an in-memory historical schema fixture, not the real shop. Backup checks are synthetic encryption/integrity tests, not a production backup or recovery drill.

`payment-handoff` also failed when attempted with the generic ESM adapter because its CommonJS loading path was incompatible with the conversion. It and `rewards-ui` / `ui-contracts` were then attempted directly with `node tests/<name>.mjs`; esbuild failed resolving local entry paths after reporting sandbox ancestor-directory access denied. No application assertion result was produced by those local attempts. The repository asset-path defect is distinct from the esbuild sandbox access failure.

Not run locally after the build failure: built-Worker `experience-http`, `rounds-http`, `roadmap-http`, `auth-integration`, `security`, `hardening`, `image-parsers`, or gear dry run. Their Linux CI step successes are recorded separately. No claim is made that all tests passed on Windows.

## Browser and HTTP observations

The in-app browser opened `https://iyaayasfw.com/login` read-only. Its accessibility snapshot showed “Member sign-in,” approved email/password guidance, Email Address and Password fields, Security check, disabled Sign in, First Time, Forgot password, Use recovery code, and pickup-only messaging. No credentials were entered, session captured or action submitted. This validates the visible legacy login surface only; it is not an authenticated layout or mobile-device test.

Unauthenticated HEAD observations (no member cookies):

| URL | Result |
|---|---|
| `https://iyaayasfw.com/login` | 200 HTML; `private, no-store`; CSP present |
| `https://iyaayasfw.com/api/pilot` | 401 JSON; no-store/CSP |
| `https://www.iyaayasfw.com/` | 301 to apex |
| `https://iyaayasfw.pages.dev/README.md` | 200 markdown; public cache behavior; no CSP observed |
| `https://62301df1.iyaayasfw.pages.dev/README.md` | Same static publication behavior |

The publicly accessible README was already known repository content. No secret-file probing or private-record access was performed. Gear entry/order and admin Access routes were not exercised with live credentials.

## Identity acceptance evidence

[IDENTITY-ACCEPTANCE-BASELINE.csv](IDENTITY-ACCEPTANCE-BASELINE.csv) preserves all 65 supplied case descriptions/expected results and adds baseline evidence. Every new-system case remains `NOT_RUN_TARGET`. That is intentional: legacy tests and code overlap are not silently relabeled as successful provider/passkey/cross-host acceptance tests.

Useful overlap: legacy session expiry/absolute lifetime and current logout; exact-Origin/host-only cookie checks; signed Access JWT denial; app-role and ownership guards; safe errors; formula-safe CSV; commerce/reward/raffle/privacy regression; synthetic schema/backup tests and last-owner role protection. Missing: full provider negative-claim matrix, accepted Microsoft personal-account bootstrap evidence, fresh-proof action grants, handoff/enrollment replay races, WebAuthn ceremony/device evidence, bulk import, revocation-preserving restore, shared-NAT capacity and real recovery drill.

## Updated input evidence register

| Input | Current disposition | Remaining evidence / action blocked |
|---|---|---|
| E-01 repo/deployment/dirty state | Discovered: repository, main SHA, local branch, clean original source, active versions and exact build linkage | Full branch-protection admin/review details unavailable; future release needs that verification. |
| E-02 stack/scripts/data/tests | Discovered from source/lockfile and safe checks | Windows portability/full local runtime verification incomplete; fix before relying on local browser acceptance. |
| E-03 hosts/Access/MFA/stable mapping | Current routes and policy read; no new auth/register/admin hosts; app maps admin by matching email plus session subject | Legacy Pages intended use; live factor/denial proof; stable admin principal provisioning. Blocks routing containment details and identity release. |
| E-04 member/history/grants/legacy assurance | Code/schema trace complete for current boundaries; stable `members.id` and legacy enrollment established | Private roster/current role grants/duplicate state not read. An authorized protected migration review must establish real coverage without exporting members into previews. |
| E-05 owner recovery/delivery | Existing owner guards and manual identityVerified attestation identified | Owner must name recovery custodian and trusted verification/delivery process. Blocks invitation and owner recovery rollout. |
| E-06 backup/recovery | Encryption/verifier/runbook inspected, synthetic tests pass | Custody, retention, RPO/RTO, complete R2 backup, real protected restore/revocation drill absent. Blocks migration/cutover. |
| E-07 providers/claims | No member OIDC/WebAuthn implementation or provider clients found in inspected app configuration | Owner/client administrator supplies isolated clients/callback control; test sanitized consumer Microsoft and Google claim cases. Blocks provider bootstrap release. |
| E-08 commerce policies/activation | Code defaults and deployed implementation established; existing monetary/stock/privacy logic preserved | Private current settings and authoritative approval for caps, earning/redemption, board fields, raffle/free-entry, gear audience and external pay host unverified. Blocks changes to those policies, not local identity scaffolding. |
| E-09 release/cohort/performance/support | Automatic deploy triggers and shared-NAT limit conflict identified | Owner names cohort/support/release authority; measured latency/error objectives accepted after baseline. Blocks production cohort rollout and performance acceptance. |

## Decisions still open

No new acceptance is inferred from the user's request to read and follow FIRST-TASK.

| IDs | Proposal requiring acceptance before its dependent release |
|---|---|
| D-04 | Google/Microsoft/passkey peers, no compulsory passkey conversion |
| D-05 | Member 30-day idle / 90-day absolute, no long-lived auth/register SSO (current 7/30) |
| D-06–D-07 | Delegated ordinary-member identity support; fresh-proof self-unlink with another usable method |
| D-08–D-09 | Invitation lifetimes and exact five-minute, one-use, action-bound freshness |
| D-10 | Admin 30-minute idle / 8-hour absolute plus Access bound (current 30m/12h) |
| D-11–D-13 | 90-day provider-scoped bootstrap grants; provider-specific authoritative matching; conservative email keys |
| D-14 | Handoff 60s; OIDC/enrollment 10m; WebAuthn challenge 5m; final grant 5m |
| D-15 | New identity detail/ceremony/session/audit retention and privacy policy |
| D-16 | Basic duplicate detection/containment before cutover; full financial consolidation separately reviewed |
| D-17 | Retain authenticated member app and separately audited guest gear audience |
| D-18 | Logical identity separation in existing storage unless physical split is justified |

The handoff is authoritative for exact proposed wording. These are a concise dependency index, not substituted accepted policy. Commercial/legal/tax/processor choices remain outside this audit.
