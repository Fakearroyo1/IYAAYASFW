# Identity release candidate — September 21, 2026

**Not ready for roster-wide release.** Target: 08:00 America/New_York. The owner authorized implementation, Cloudflare edits, protected backup/recovery and specific live tests on Jake's existing account, plus explicit Access mappings for Jake and Mason. No team messages or bulk invitations are authorized. The current candidate has not been deployed.

## Readiness

| Area | Evidence status | Remaining gate |
|---|---|---|
| Google | MOCK-ONLY | Real enrollment, login and fresh addition using the registered client |
| Personal Microsoft | MOCK-ONLY | Same real checks; organizational accounts remain rejected |
| Passkeys | MOCK-ONLY | Real iPhone/Safari, Android/Chrome and desktop flows; both phones are available |
| Administrator host | MOCK-ONLY / configuration verified | Real MFA success, cancellation/denial/expiration and principal provisioning |
| Backup recovery | REAL TESTED | Refresh protected snapshot before migration if data changes |
| Owner emergency account control | REAL TESTED / owner-attested | Owner reported account access good after the independent recovery rehearsal request; private authentication was not observed by the agent |
| Legacy password and commerce | Locally tested | Final candidate CI and deployed owner smoke |
| Sixty concurrent shared-NAT logins | MOCK-ONLY / compiled runtime passed | Final CI and deployed smoke; no production load test |
| Roster-wide enablement | BLOCKED | All required real methods, admin, load and recovery checks |

New methods use maintained openid-client 6.8.8 and SimpleWebAuthn server 14.0.2/browser 14.0.0. Provider subjects and passkey IDs bind to existing immutable member IDs. Conservative Google bootstrap requires a separately granted authoritative address; Microsoft email bootstrap remains disabled. Explicit Microsoft linking does not assume an email match. Credentials, invites, actions and handoffs are one-use/current-state checked at transactional commit.

## Implemented controls

Additive identity tables reside in the established D1. No financial, inventory, rewards, privacy or guest-gear rules were changed. Existing member sessions retain seven-day idle/thirty-day absolute bounds; admins retain thirty-minute idle/twelve-hour absolute bounds and are capped by Access verification. A password change revokes sessions derived from new identity methods, including the changing identity session, as a security containment effect; valid legacy password sessions retain their prior behavior where safe.

All methods default off. `IDENTITY_ROLLOUT=owner-smoke` restricts new credential flows to Jake while preserving the existing MFA-protected administrator route during rehearsal. `all-approved` completes host separation, removes administrator authority from apex member sessions and enables eligibility for all approved members. Both administrators need verified mappings before that cutover. An incoming email never provisions a mapping. The first release gives only Jake new identity-grant/review authority.

Invites default to 24 hours, allow 15-minute in-person or up to seven-day explicit expiry, and supersede pending invites of the same purpose. Bootstrap grants expire after 90 days and cannot be renewed by a repeated import. Fresh existing-method proof and final grants last five minutes; transactions ten minutes; handoffs sixty seconds. The per-method switches are checked again at final handoff redemption.

New metadata retention: unmatched details 30 days; expired ceremony secrets within 24 hours; ended identity sessions 90 days; identity audit 365 days, preserving incident holds. Cleanup is bounded and does not delete legacy history or business records. Invocation URL logging is disabled in the candidate to keep OAuth codes out of request logs.

## Live infrastructure evidence

The unused Pages project and its 87 deployments were permanently deleted after explicit owner approval. Its deployment inventory was retained privately. The canonical Pages hostname stopped resolving. Main and gear automatic Workers Builds deployments were paused with a failing deploy command; the previous commands are `pnpm run deploy` and `pnpm run deploy:gear`. Do not restore automatic deployment until the reviewed release process is complete.

A separate Access application now protects the entire intended administrator hostname. It uses a new reusable explicit-email policy for the two existing administrators, Google Access, security keys/biometrics, a thirty-minute independent MFA session and no bypass/service-auth decision. Configuration was read back. This does not prove real factor denial. The old apex Access application remains intact. No new Worker host route or identity schema has yet been deployed.

## Protected recovery evidence

At 02:31 UTC, consecutive full D1 exports had identical application schema and all table/view digests. The encrypted backup covers 88 application tables and 10 views; Cloudflare's reserved `_cf_KV` system table is outside application export scope. The encrypted R2 backup covers all 21 objects (4,013,317 bytes) with metadata and checksums. Complete before/after R2 inventories matched.

At 02:37 UTC, independent key retrieval and isolated memory restore passed. Every table/view digest, immutable member/balance state, schema integrity and foreign key check matched. All 21 image references resolved. Applying the identity schema twice preserved existing rows and views. An isolated containment simulation revoked pending setup/recovery/session authority. The production database was not restored or mutated by this drill. See the owner runbook for stale-backup revocation handling and real-disaster cutover restrictions.

## Candidate validation

- Typecheck, main build and gear dry build passed.
- Identity state/import: 62 checks, including simultaneous invite completion/handoff redemption and sixty-row preview; signed synthetic OIDC/WebAuthn: 56, including counter-rejection audit; compiled Worker host/CSRF/admin/fresh-addition flow: 57, including changed-proof confirmation denial; rollout/method-disable/last-method races: 10; setup/recovery containment races: 24.
- Existing suites passed locally: pilot 74; beta 63; rounds 1–2 48, rounds 3–4 61, rounds 5–7 86; earning 77; redemptions; profile experience; admin experience 80; payment handoff; rewards UI 30; UI contracts 28; bounded HTTP 8; experience HTTP 104; rounds HTTP 38; roadmap HTTP 61; authentication 96; security 62; hardening 589; image parsers 4; backup crypto 4.
- Some esbuild-based tests required execution outside the Windows sandbox after parent-directory reads were denied. Assertions and production code were not weakened.
- With sixty distinct synthetic members and six requests in flight behind one IP, the former 40/IP limit accepted 40 and rejected 20. After raising the IP limit to 180/15 minutes, the full sixty-concurrent test accepted all 60 with correct member binding; per-account 10/15-minute rejection remained effective. Candidate local p50 7,827 ms, p95/max 7,829 ms; the full check including subsequent abuse attempts took 12,576 ms. Initial Windows transport failures were resolved by consuming response bodies and performing database verification after the timed request burst. The same correctness assertions remain. No production password-hashing change was made. These measurements do not establish a production SLO.

All protocol tests above use synthetic providers/authenticators and isolated storage. They do not establish real provider/device/MFA compatibility. No production/provider load test was performed.
