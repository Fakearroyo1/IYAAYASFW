# Member CSV import and private invitations

This change extends the identity branch reviewed at `00c738b534153a7e4dd7352234bbdf83acd82f6c`. It does not deploy the application or change production flags, provider credentials, session durations, or existing financial records. No new database migration is needed: the identity release's existing tables and triggers are required.

## Owner decisions

- Every new member has an email address.
- Import new members and update existing members are separate workflows.
- Explicit Google addresses may receive first-sign-in preauthorization.
- Other sign-in methods enroll through member-bound private invitations, shared as a link, QR code, or copyable code.
- Preserve existing members, IDs, credentials, sessions, financial history, rewards, and other site features.

## Import new members

1. Open **Members & access → Sign-in, invitations & CSV → CSV import** on the administrator host.
2. Choose **Import new members** and **Download CSV template**.
3. Open the file in Excel. Keep its column headings and enter one member per row.
4. Save as **CSV UTF-8 (.csv)**, then upload or drop the file into the importer.
5. Choose **Preview new members**. Correct errors and review name warnings before continuing.
6. Select ready rows and choose **Verify & create selected members**. Verify using an existing supported owner method and confirm the displayed changes.
7. Review the results. Download the results CSV or open **Member & invitation** beside a successful row.

The limit remains 100 data rows and 64 KB per upload. Preview lasts ten minutes; fresh action verification lasts five minutes. Each selected row is transactional. A failure on one row does not undo previously completed rows, and retrying the same batch does not create them again. **Refresh import status** on the confirmation screen retrieves committed rows after an interrupted response. A later reupload identifies existing emails and does not overwrite them.

| Column | Meaning |
| --- | --- |
| `display_name` | Required, 1–80 characters. |
| `email` | Required, supported primary member email, at most 200 characters. Stored lowercase to match the established member account contract. |
| `contact_email` | Optional separate informational address. Does not authorize login. |
| `google_bootstrap_email` | Optional exact Google-account address. Creates a one-use Google preauthorization when access is enabled. Blank means invitation-based onboarding. |
| `access_enabled` | Required: TRUE/FALSE or 1/0, case-insensitive. FALSE cannot be combined with new Google preauthorization. |

The primary email is **not** silently treated as a Google identity. Google may differ from the primary/contact email. Existing provider matching rules are retained: automatic first association requires Google's authoritative Gmail/managed Workspace proof, enabled Google bootstrap flags, and an allowed rollout. Google accounts using other third-party email domains can enroll by invitation. Importing does not enable provider flags or expand the rollout audience.

New-member defaults follow the existing add-member screen: ordinary member role, zero debt/credit, $30 tab limit, snacks and gear allowed, community posting enabled. Account activation is explicit in the CSV. The existing creation triggers initialize identity handles, profiles and rewards metadata. Import columns cannot set passwords, administrator roles, financial balances or rewards.

Duplicate primary emails (including disabled members) are skipped or reported for correction; they never reactivate, merge, or update existing accounts. Duplicate addresses within a file block all affected rows. Duplicate names produce a review warning rather than merging people. Reserved, linked or revoked Google addresses cannot be assigned to a different member by import.

## Update existing members

Choose **Update existing members** and download its template, which supplies existing IDs. The legacy six-column contract remains supported. Blank cells preserve current values. Explicit access changes use the existing revocation triggers; consumed or revoked provider reservations are not renewed. The legacy Microsoft bootstrap column remains recognized for compatibility, but automatic Microsoft association is still disabled; use invitations.

A template for more than 100 existing members still requires separate batches under the existing limit. The new-member template is independent of current roster size and contains headings only.

## Whitelist-controlled registration

New methods are enabled for every active member on the existing whitelist, including
members added later manually or through CSV. No extra beta list or rollout unlock is needed.
Members with an existing password can open **Linked methods**, verify it, and add Google,
Personal Microsoft or a passkey. A new member uses their private member-bound invitation.
Provider email by itself does not authorize registration. Disabled or unknown members
cannot finish registration, even if a provider signs them in or they hold an old invitation.
Google ordinary login is available; account-change verification uses password, passkey or Microsoft.

Manual Add member opens the same member's invitation tools. The identity-enabled server
no longer issues legacy First Time setup codes. Previously issued codes retain their original
expiry and redemption behavior; existing password recovery is unchanged.

## Private invitations

1. Open the intended member using search or the import results.
2. Confirm the person through a known contact method.
3. Select enrollment or recovery and an existing expiry: 15 minutes, one day, or seven days.
4. Verify and create the invitation, then confirm the exact member/action.
5. Let the intended member scan the QR code, copy the private link into a direct message, or copy the invitation code for them to paste at `https://register.iyaayasfw.com/identity`.
6. Hide the invitation when finished. Regenerate through the existing invitation action if another is needed; the earlier pending invitation for that purpose is revoked.

The QR code encodes the same full invitation link and is generated locally in the browser. It is never sent to an external QR service. The copyable code is the existing strong random invitation token, not a weaker short PIN. QR, link and code all use the same expiry, revocation, member-binding, wrong-signed-in-member protection, explicit confirmation and one-completed-enrollment rules. The database stores a hash of the token. The visible invitation is held only in page memory; raw invitations are excluded from CSV reports and audit records.

No messages are sent automatically. Sharing the link is a deliberate owner action. A private invitation is authority to enroll for its named member, so it is not a public/group registration code. The member may choose an enabled Microsoft account or passkey without requiring that provider's address to equal the roster email. Existing password access remains available.

## Implementation and validation

- `lib/identity/imports.ts`: explicit modes, validation, create-only member transactions, server-stored previews, exact-action approval, race checks and recoverable results.
- `lib/identity/roster-format.ts`: shared CSV contract and spreadsheet-safe output.
- `app/identity/member-import.tsx`: template downloads, upload/drop, previews, selected-row confirmation and result reports.
- `app/identity/private-invitation.tsx`: local QR generation, private link/code copying and expiry display.
- Existing invitation backend and enrollment flow retained; response adds recipient labels.
- `tests/member-import.mjs` is included in the application CI workflow; HTTP tests cover new template/preview/review permissions and privileged-column rejection.

All tests use synthetic accounts and isolated databases. No production member export is used. Production provider/device acceptance remains part of the identity release's existing owner-smoke gates. Publish through that established release process; do not use the generic deployment command as a shortcut.

### Verification for this change

- The full application workflow passed all 32 commands locally, including builds, authentication, checkout/accounting, rewards/raffles, security and backup restoration.
- Final importer suite: 132 passing checks, including 60-member creation, retry recovery, late duplicate/grant conflicts, per-row rollback, proof revocation, Google association and Microsoft invitation enrollment.
- Final compiled Worker: 103 passing identity HTTP checks, including CSV JSON-escaping overhead and owner-only endpoints.
- Final TypeScript check passed; dependency audit reported no known vulnerabilities.
- Chromium UI checks used the actual React components with synthetic API responses: downloadable template, file upload, preview selection/error exclusion, verification return, results and invitation navigation, QR/code visibility, and no viewport overflow at 390 pixels. Desktop and mobile screenshots were visually reviewed.
- The rendered invitation QR image was independently decoded to the exact synthetic invitation link.

These results establish local/synthetic coverage, not a new real-provider or production-device acceptance result. Production data and hosting were not changed.
