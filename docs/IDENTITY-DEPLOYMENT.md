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
three new methods on for the owner stage, keeps automatic email bootstrap off,
and adds only the four exact approved hosts.

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
under **Members & community → Members & access → Sign-in, invitations & CSV**.
The same screen also contains member purchasing permissions. Existing account-suite links
redirect here, including the return from fresh owner verification. It includes member-bound
invitations, independent login-request review and previewed CSV imports. CSV
templates contain existing member IDs; blank fields preserve stored values.
No email/name similarity authorizes a link, and methods cannot be transferred
between members or used to merge financial history.

## Current-member beta

The owner explicitly requested that the members already on the site test the deployed
features as a small beta group. Use the same checked manual procedure with the explicit
`member-beta` stage. This does not satisfy or remove any `all-approved` requirement.
The private snapshot must record the owner's beta authorization, the fixed member IDs,
the exact active-roster SQL and its fresh successful D1 response, verified owner mapping,
and passing owner Google/Microsoft/iPhone/MFA-denial/recovery results. Unknown, inactive,
duplicate, malformed or empty cohorts fail preparation. Retain pending acceptance tests
as pending, with `fullReleaseReady: false`.

The prepared `IDENTITY_BETA_MEMBER_IDS` binding contains only those immutable IDs.
It is private deployment configuration, excluded from Git and public context responses.
An email domain, invitation, CSV creation or later activation cannot add a member to this
cohort. Any expansion requires another explicitly approved, checked release. Password
login and existing sessions remain available. Rollback to owner-smoke denies new beta
flows even if a previous list remains; the per-method switches still apply at redemption.
The unmapped administrator retains the existing MFA path until independently verified.

When identity is enabled, the server refuses new First Time setup codes. Adding a member
opens the owner's invitation tools; non-owner admins see the owner handoff instructions.
Existing issued codes can still be redeemed and password recovery is unchanged. During
beta, newly imported/created members require a reviewed cohort update before invitation
enrollment. This feature update requires no schema migration.

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
