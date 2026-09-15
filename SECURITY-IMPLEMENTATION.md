# Security hardening implementation — September 15, 2026

This change implements the application findings from the security review. It is
prepared for the existing `iyaayasfw-supply` Worker and preserves business data.
It must not deploy until the Cloudflare prerequisites below pass. Production
account settings have not been changed or independently verified in this session.

## Application protections

- Administrator management reads, writes, recovery, uploads, reporting, and CSV
  exports require Cloudflare Access verification bound to the current application
  session. JWT checks cover signature, issuer, audience, expiry, token age, and the
  signed-in email. A second device does not inherit verification. Proof expires
  within 30 minutes and is invalidated when the application session is revoked.
- The dedicated Access callback is `/api/admin/access`. The Access policy must
  require independent MFA with a security key or device biometrics. Protecting a
  page alone is insufficient; the backend checks cover the mixed member/admin APIs.
- Member password login and whitelist permissions remain. First Time now checks
  email plus the private setup code before allowing password creation. Existing
  passwords and accounts are retained.
- Administrators issue a private, hashed, 128-bit recovery code after confirming
  identity through a known contact channel. Codes expire after one hour, are
  consumed transactionally, and let members choose their own replacement password.
  Redemption invalidates previous sessions. Changing one's own password also
  cancels outstanding recovery codes. Administrators cannot assign passwords.
- Turnstile is verified server-side on login, first-time setup, activation, reset
  requests, and recovery. Tokens must match the expected hostname and `account`
  action. Provider failure, missing configuration, or invalid tokens fail closed.
- History uses keyset pagination, bounded pages, dedicated pickup queries, full
  aggregate financial/pricing totals, and streamed complete CSV exports. A 501-order
  fixture retains all records across 11 pages and in a 501-row export. Date-filtered
  exports are not database snapshots: concurrent edits can still affect their values.
- Previous PR protections remain: role-specific session lifetimes, request-size and
  time limits, spam/backlog caps, transaction session guards, protected cost data,
  CSP nonces/security headers, blocked unused Server Actions and image optimizer,
  and disabled alternate Worker URLs.
- Hourly maintenance removes bounded batches of expired authentication metadata.
  It does not delete accounting, inventory, audit history, or pending reset requests.
- Dependency audit currently reports zero advisories. `image-size@2.0.3` has one
  exact exception to the seven-day release-age policy. Its tarball integrity,
  registry signature, and parser changes were reviewed; malformed ICNS/JXL/HEIF
  inputs are regression-tested with external timeouts. Other releases retain the
  existing minimum-age rule. No advisory is ignored.

## Cloudflare prerequisites (account access needed)

Use `infrastructure/security-policy.json` as a reviewable configuration contract.
The application and policy payloads are templates; do not replace existing account
rules wholesale. The administrator-email placeholder must be replaced with the
approved administrator list.

1. Create the self-hosted Access application for exactly
   `iyaayasfw.com/api/admin/access`, with a maximum 30-minute session. Add explicit
   administrator emails and require independent security-key/biometric MFA in
   **every allow policy**. Do not add Bypass or Service Auth policies. Complete
   administrator enrollment and retain a separate owner recovery method.
   New application administrators must also be included in this Access policy.
2. Enable independent MFA in the organization as needed; preserve unrelated
   applications. Disable IdP AMR matching for this deployment's strict independent
   verification profile. Do not silently weaken the policy if the account cannot
   support the specified factors.
3. Create a managed Turnstile widget restricted to `iyaayasfw.com`. Set these on
   the Worker's **runtime** configuration (not only its build settings):

   | Runtime variable | Type |
   |---|---|
   | `ADMIN_ACCESS_TEAM_DOMAIN` | Text: `https://YOUR-TEAM.cloudflareaccess.com` |
   | `ADMIN_ACCESS_AUD` | Text: application audience |
   | `ADMIN_ACCESS_APP_ID` | Text: application ID |
   | `TURNSTILE_SITE_KEY` | Text: widget site key |
   | `TURNSTILE_SECRET_KEY` | Secret: matching widget secret |
   | `OWNER_EMAIL` | Preserve existing value |

   Remove the initial runtime `BOOTSTRAP_PASSWORD` once activated. Never commit
   secret values or copy build API tokens into runtime variables.
4. In private **build** secrets, add `CLOUDFLARE_SECURITY_READ_TOKEN` with scoped
   read permissions for Workers settings, Access applications/policies/organization,
   Turnstile widgets, and R2 domain settings in this account. Keep it separate from
   the narrowly scoped deployment token. Retain `CLOUDFLARE_D1_DATABASE_ID`.
5. Disable public managed/custom domains on `iyaayasfw-supply-images`. Images are
   served by the authenticated application. Confirm unused service bindings or
   other Workers cannot expose this bucket or D1 data.
6. Inspect the unused `iyaayasfw` Pages integration. Disable its automatic builds
   and remove production credentials/bindings after confirming its role. The new
   deployment script rejects **all Pages builds and any branch other than main**
   before database writes. This code guard does not revoke already exposed secrets
   or delete previously deployed previews; those require account-side cleanup.
7. Review actual WAF managed rules, skip/bypass rules, and bot controls. The supplied
   edge authentication rate-limit candidate is 30 requests per IP per 10 seconds,
   with a 10-second block, intentionally looser than account limits to accommodate
   shared unit networks. Confirm plan support and normal shared-NAT behavior before
   enforcing it. Do not challenge JSON API responses with a browser-only page.
8. Verify TLS 1.2 minimum, HTTPS redirects, certificate health, DNSSEC and registrar
   DS correspondence, account/collaborator MFA, least-privilege tokens and rotation,
   usage alerts, effective log retention, and Workers/D1/R2 quotas. DNSSEC and global
   transport settings must be reconciled with the actual account, not guessed.

`node scripts/security-preflight.mjs dist/server/wrangler.json` performs read-only
checks for the critical Access policy, runtime variables, widget domain, R2 privacy,
branch, and routing. It blocks deployment before schema changes on missing or
unverifiable prerequisites. Its API integration still needs validation against the
actual account. It is not a complete WAF/account/backup audit. The deployment keeps
existing runtime text variables and secrets, then applies only additive schema files.

## Release protection and recovery

- CI covers application/security tests, dependency auditing, and a checksum-pinned
  Gitleaks scan of the complete available Git history. Secret output is redacted.
- Apply `infrastructure/main-protection.json` through GitHub branch administration
  for main: require passing checks, one independent approving review, dismissal of
  stale reviews, resolved conversations, no force pushes/deletion, and enforced
  protections for administrators. This needs a trusted second reviewer; adding the
  JSON file alone does not activate repository protection. Administration access
  was not exposed here.
- Before rollout, create a private encrypted D1 export:
  `node scripts/backup-database.mjs /PRIVATE-PATH/pre-security.encrypted`.
  Provide a random 32-byte hex `BACKUP_ENCRYPTION_KEY` through the local secret
  environment and keep it separately from the backup. This command reads D1;
  it never resets it. Plaintext exists only inside a temporary owner-only directory.
- Verify locally with
  `node scripts/verify-backup.mjs /PRIVATE-PATH/pre-security.encrypted` using the
  same private key. The verifier restores into memory and checks SQLite integrity,
  foreign keys, and required table counts. It cannot target production.
- Also make a private independent copy of all R2 product images and verify sample
  object checksums. Confirm actual D1 Time Travel retention. A synthetic encryption
  test is not a completed production backup or cloud restore drill.
- Test a full restore into a separately named Cloudflare database, with isolated
  bindings and no production routes. Record the time needed and compare record
  counts. Do not use a database reset or reseed as a rollout step.
- After prerequisites, merge through the protected release process. Confirm Chrome
  and Safari member sign-in, setup/recovery, snack/gear visibility, admin MFA,
  purchase/idempotency, pickup, images, and complete exports at the custom domain.
  Verify alternate hosts, headers, error/CPU/usage metrics, and challenge behavior.

The additive `SECURITY-SCHEMA.sql` retains passwords, members, products, historical
prices/costs, balances, orders, and stock. New session policy can require older
sessions to sign in again. Roll back code through the previous Worker version if
needed; leave additive tables/indexes in place and do not restore over live business
transactions. Previous code does not require the Access callback or Turnstile, so
rollback also withdraws those new application protections.

## Verification status

Local type checking and production build passed. Existing financial/inventory and
Workers authentication/concurrency checks passed. New tests cover MFA identity and
session boundaries, one-time recovery races, invalid challenge tokens, pagination,
complete totals/exports, parser deadlines, and encrypted-backup integrity. No live
load test, production migration, password reset, or business-data mutation was run.
The owner explicitly approved public publication. The complete implementation is
published in [PR #2](https://github.com/Fakearroyo1/IYAAYASFW/pull/2), starting with
commit `c958f2e11e3b51c8abdd7f12a3e2d025794ff5b6`. GitHub's application checks and
dependency audit passed. The first full-history secret scan identified a synthetic
password created only in the isolated Miniflare test database. The fixture now
generates that password per run. A documented exception covers only that exact
historical finding (commit, file, rule and line), without excluding test files or
disabling a rule. The scan emits location-only diagnostics without secret values.
Check the latest PR results for the complete-history rescan status.
Provider-side configuration remains unverified. No main branch or production
database changes were made. The PR remains a draft pending release prerequisites.

References: [Access independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/),
[Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[Turnstile server verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
[Gitleaks release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1).
