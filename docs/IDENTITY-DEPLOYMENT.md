# Controlled identity deployment

Automatic main/gear deploy commands remain held in Cloudflare. `pnpm run deploy`
continues to require its existing main-only security preflight; it is not the
command for this manual candidate. Never label a candidate branch as main.

`scripts/prepare-identity-release.mjs` prepares an explicit manual configuration
from the built Worker and a recent read-only Cloudflare API snapshot. The snapshot
is private, ignored, contains no secret values and records successful complete
API responses for runtime binding metadata, both Access applications/policies,
organization MFA, Turnstile, private R2, Pages absence, disabled alternate URLs,
custom domains and both held build triggers. Include the actual CI result for the
candidate SHA and completed protected recovery evidence. The source commit must
be clean and the observation no older than ten minutes. Do not fabricate evidence.

Run `node scripts/prepare-identity-release.mjs <private-snapshot.json> owner-smoke
<commit>` on one line. This only writes `dist/server/identity-release.json`. Review
the prepared config and use the installed Wrangler's deploy dry run. The prepared
config retains runtime variables and secrets, uses the original D1/R2, sets all
three new methods on for the owner stage, preserves the approved Google preauthorization setting,
and adds only the four exact approved hosts.

Google preauthorization defaults off when absent. An explicit owner-authorized change
uses private snapshot `googleBootstrap: {enabled: true, authorization:
"owner-request-google-preauthorization", mode: "explicit-member-bound-grants"}`.
Preparation requires passing ordinary Google sign-in evidence and retains every other
release gate. Later releases preserve the live setting; an explicit false override
supports rollback. This enables only existing one-use, member-bound grants for
Google-authoritative addresses, never matching arbitrary roster emails. It does not
enable Google fresh account-change proof. No migration or import replay is needed.

Before the first live deployment:

1. Refresh and verify the protected current backup if the stored data changed.
2. Apply `IDENTITY-SCHEMA.sql` additively to the existing D1 after its existing
   schemas. The protected restore proved repeated application and shared-gear
   compatibility. Do not replay an initial schema or production data dump.
3. Save only independently verified Access issuer/subject mappings, explicitly
   authorized by the owner. Recheck each target's existing active admin role.
   Jake alone receives `identity_owner=1`. No incoming email auto-provisions one.
4. Deploy the exact prepared configuration with the project's installed Wrangler,
   retaining secrets. Record commit, config checksum, deployment/version IDs and
   route readback. Disable invocation URL logs before any provider callbacks.
5. Verify anonymous host/API denial, password fallback and read-only commerce,
   then perform the real owner provider, phone, admin-MFA and recovery checklist.

`owner-smoke` sends Jake and administrators with an existing principal mapping
to the administrator host and removes their apex administrator authority. A
revoked mapping never restores the old apex authority. Unmapped administrators
retain the established MFA-protected path while new member methods are tested
only for Jake. This is a temporary gate, not the requested final audience.
The owner deferred Mason's test because he is unavailable; his subject mapping
must remain pending until verified. Keep his established permissions unchanged.

Google ordinary login and Google fresh account-change proof have separate flags.
Keep `IDENTITY_GOOGLE_FRESH_ENABLED=false` until branding approval, Session age
claims and a real fresh-proof test establish support. Do not weaken the
five-minute signed authentication-time requirement to bypass Google settings.

The owner account suite is at `https://admin.iyaayasfw.com/?view=admin&section=members&workspace=identity`,
under **Members** (member detail for sign-in methods; **CSV import** for batch changes).
The same screen also contains member purchasing permissions. Existing account-suite links
redirect here, including the return from fresh owner verification. It includes member-bound
invitations, independent login-request review and previewed CSV imports. CSV
templates contain existing member IDs; blank fields preserve stored values.
No email/name similarity authorizes a link, and methods cannot be transferred
between members or used to merge financial history.

## Whitelist-controlled member beta

The owner explicitly requested that current members test the deployed system and that
whitelist additions work without additional rollout unlocks. Use the same checked manual
procedure with the explicit `member-beta` stage. All active existing and future members
are eligible; there is no separate beta ID list. The existing whitelist remains authoritative:
member-bound invitations, verified existing-account proof, active status and current-state
transactional guards are still required. Provider email alone never creates membership.
Disabling a member prevents enrollment and sign-in, including a ceremony already in progress.

The private release snapshot records the owner's whitelist-registration authorization,
the active-roster query, verified owner mapping and passing owner Google/Microsoft/iPhone/
MFA-denial/recovery results. Keep unfinished real tests pending with `fullReleaseReady: false`.
This stage enables the complete member workflow without claiming completed full acceptance.
The unmapped administrator retains the established MFA path until independently verified;
admin migration is separate from member registration and never grants authority by email.

When identity is enabled, the server refuses new First Time setup codes. Adding a member
opens that member's invitation tools; non-owner admins see the owner handoff instructions.
CSV-created active members can use invitations immediately, without a second allowlist or
another deployment. Previously issued codes remain redeemable until their existing expiry,
and password recovery is unchanged. This feature update requires no schema migration.

`all-approved` preparation additionally requires both explicit admin mappings and
recorded passing Google, Microsoft, iPhone/Safari, Android/Chrome, desktop,
administrator MFA denial, owner recovery and deployed legacy-commerce checks.
Only then switch stages and verify the roster-wide result. Do not remove a failed
method from the checklist and call this phase complete.

For rollback, retain additive tables and current data. Disable a failed method
or return to the owner stage using a newly checked configuration. Before rolling
back to pre-identity code, remove the new auth/register/admin Worker domains so
old routing cannot expose application APIs there. Keep the Access application
and original apex/gear domains. Do not restore an older data snapshot as a code
rollback. Do not restore automatic deployment while its apex-only route guard
and deploy script are incompatible with the active identity release configuration.
