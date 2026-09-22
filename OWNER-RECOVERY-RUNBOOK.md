# Owner recovery runbook

Jake is the sole recovery custodian. Recovery does not depend on the snackbar app. Keep security keys/passkeys and provider recovery codes under your control, with the backup encryption key in your independent password manager. Never put actual keys or codes in this document, Git, or chat.

## Current evidence

On September 21, 2026, the owner generated a key in a private local form, saved it in the password manager, then independently retrieved and verified that key. An encrypted D1 snapshot and encrypted R2 archive were restored into memory only: 88 application tables, 10 views and all 21 objects matched; 21 database image references resolved. Repeating the additive identity schema preserved every prior table/view digest. A containment rehearsal affected only the in-memory copy and revoked pending access. Production was not restored or modified by the drill.

The 03:39 UTC post-deployment archive repeated full reconciliation with 102 tables, 10 views and 21 images; all preexisting business records matched the pre-migration archive. At 03:50 UTC, that archive also passed the stale-access rehearsal: synthetic old methods, administrator mapping, setup/recovery codes, invitation, session, ceremony and handoff were invalidated in memory. All restored accounts were kept inactive pending independent owner verification. Original financial/history/privacy rows and password hashes remained unchanged; the existing accounting cache revision incremented as expected for access-only member updates. No actual account was disabled by this drill.

After being asked to rehearse independent Cloudflare, GitHub, Google and Microsoft access using an alternate secured method in another browser session, the owner reported "Account access is good" on September 21, 2026. This is owner-attested account recovery evidence; the agent did not observe the private authentication steps. Application administrator MFA denial remains a separate release check.

## Locate and verify backups

The owner-selected **IYAAYASFW Encrypted Backups** folder sits beside the repository in the local Snackbar Site workspace and is synced by the owner's existing OneDrive setup. Files ending in `.encrypted` use AES-256-GCM authenticated encryption. Keep the portable 32-byte key separately in the password manager. The working key under the ignored `.sites-runtime/private-backup` directory is Windows-user DPAPI protected; it is not the only recoverable copy. This Windows working copy will not decrypt on an unrelated replacement machine.

The backup tools never print keys or record contents. Use the project's PowerShell 7 runtime. `scripts/backup-key-entry.ps1` provides masked local entry and a separate `-VerifyFromVault` mode. `scripts/backup-with-key.ps1` loads the protected working key only into the child process environment. The verification sidecar contains nonsecret status and counts.

Backup manifests record the evaluation time for age-based SQL views. Restore verification evaluates views at that recorded instant; a comparison with an earlier archive re-evaluates both restored snapshots at a common instant after validating each original manifest. This prevents elapsed reminder time from masquerading as changed business data. Every stored table and view remains checked. Earlier archives without a recorded evaluation time use their recorded export start time; a mismatch still stops the verifier for review.

For a new backup, inventory the entire private R2 bucket, including all pages. Export D1 twice and require matching schema and all table/view digests; retry if writes occurred between snapshots. D1 blocks database requests briefly during each export. Download every inventoried object, retain HTTP/custom metadata in the encrypted archive, then compare another complete R2 inventory. This is not an atomic cross-service snapshot: accept it only when object versions and all database references reconcile. Redo the backup if either side changes.

Verify both archives with `backup-with-key.ps1 -Mode verify`, supplying the database archive, `-Assets`, the fresh `-Inventory`, and `-RehearseMigration`. Decryption and SQL restore use memory only; no public preview or production target exists in this command. On Windows, transient plaintext export directories have an owner-only ACL and are removed after encryption. A failed operation is not a passed recovery gate.

For an archive containing the identity schema, add `-RehearseStaleIdentity` to test the closed-access recovery path with synthetic stale authority in memory. Add `-Baseline` with the earlier encrypted database archive to reconcile all its business tables/views against the current one; session/rate-limit/Access-cache/guard changes are expected operational exceptions. The stale rehearsal intentionally blocks all access in its disposable copy. It produces a verification receipt, not a deployable restored database, and cannot target production or a disk-backed database.

## If the app or a provider is unavailable

1. Use your independently saved Cloudflare account access, an enrolled security key/passkey or recovery code. Use a second secured browser/device for the rehearsal, without signing out the only working control-plane session.
2. Verify access to the existing Worker, D1, private R2 and Access configuration. Repeat independent access verification for GitHub and both provider consoles. Do not revoke the last functioning key to test recovery.
3. A failed Google/Microsoft/passkey method can be disabled independently with its `IDENTITY_*_ENABLED` runtime flag. Existing password access remains available. Do not weaken MFA, add a shared password, or publish an emergency login URL.
4. If an administrator's Access identity changes, verify the replacement through the control plane and a known independent channel, then explicitly replace its stored issuer/subject mapping. Never map an incoming email claim automatically. Revoke the old mapping and its sessions.
5. If a member lost all methods, independently verify the person before creating a member-bound, short-lived recovery invitation. Inspect and revoke compromised methods and sessions; do not merely re-enable a compromised account. Keep the original member ID and ledger.

## Rollback and stale-backup safeguards

Keep both Worker automatic deployment commands paused during rollout. Record a verified Worker version and its matching configuration before each manual release. A code rollback uses a containment-fixed version and the same D1/R2 bindings; leave additive identity tables intact. Do not restore old business data merely to undo code.

An older backup may predate a credential, member, principal or session revocation. Before any real disaster restore, preserve current security events/revocation state independently, stop writes for the cutover, reconcile all later events, and invalidate sessions plus pending setup/recovery/invitation/handoff authority in the restored copy. Review every member's access and credential status against the latest revocation evidence. If that evidence is unavailable, deny restored identity methods until the owner re-verifies them and require fresh sign-in. Do not activate stale credentials or restore old financial rows over newer transactions.

No production restore is authorized merely by this runbook. Prepare and inspect the complete isolated result, a write-free cutover plan, and exact impact before seeking authorization for an actual production recovery.
