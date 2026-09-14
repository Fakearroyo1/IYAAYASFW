# IYAAYASFW Supply

Unit store with approved-member access, admin-assigned passwords, durable purchase records, CSV exports, and product-image management.

**Deployment:** Follow [LAUNCH.md](LAUNCH.md). This branch replaces the earlier Cloudflare Access migration. Neither ChatGPT accounts nor Cloudflare Access are required for members.

## Access

- Administrators create members in Manage → Members and assign passwords separately. No public registration or password-change endpoint exists.
- The owner can select Member or Administrator when editing a member. Administrators manage the shop, inventory, payments, reports, and regular members. Only the owner can grant or remove administrator access or manage another administrator. The owner cannot be disabled or demoted. Role changes revoke existing device sessions; the assigned password remains valid.
- Passwords are scrypt hashes (N=16384, r=8, p=5); plaintext is not stored or returned. Minimum length: 15 characters.
- Sessions use random 256-bit tokens; only token hashes are stored. Secure, HttpOnly, SameSite=Lax, host-only cookies persist for up to 400 days and renew on authenticated store API visits. Browser removal or expiry can still require sign-in.
- Password replacement, account deactivation, device revocation, and logout invalidate sessions. Deactivation deletes sessions so reactivation cannot restore old devices.
- Login limits apply to IP addresses and email addresses. Mutations require same-origin requests. Every store API and uploaded-image request checks identity on the server.
- Membership requests are closed. The member table and admin enrollment remain the approval mechanism; a future request queue must never automatically grant access.
- No real credentials or records snapshot belongs in this public repository. Owner identity and bootstrap credentials must be configured as Cloudflare secrets. The D1 database ID is supplied through a private build variable.

## Development

Use Node 22.13+ and the pnpm version pinned in package.json.

```
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
node tests/auth-integration.mjs
```

The integration suite runs the compiled Worker with isolated D1/R2 storage. On filesystems that cannot fsync temporary SQLite files, set TMPDIR to a suitable local filesystem (for example /dev/shm on Linux).

`pnpm run deploy` adds only the idempotent tables/indexes from AUTH-SCHEMA.sql to the existing D1 database and deploys the Worker. It does not reset/import the store database. Do not use the original schema migrations on an already initialized database.

The deployment serves iyaayasfw.com and retains the workers.dev address as a fallback.

## Shop controls

- Use Open shop / Pause shop on the Shop page or under Manage. Payment settings are saved separately and do not change whether the shop is open.
- Only available, priced products with a tax rate and positive stock (or a gear preorder) can be purchased. Hidden products remain in Inventory. Out-of-stock items show their status.
- SHOP-READY.sql is a one-time correction for the configured catalog imported with checkout paused. It opens the shop only if a sellable product exists, records the change, and preserves product counts, prices, balances, and credentials. Its migration marker prevents later deployments from reopening an intentionally paused shop.
- New members are taken directly to password assignment after saving. Contact actions and device sign-out live within Edit member.

Verification: run `node tests/pilot.mjs`, `node tests/shop-migration.mjs`, and (after building) `TMPDIR=/dev/shm node tests/auth-integration.mjs`. Tests use isolated records and never connect to the production database.

Product images are stored as small base64 parts under `asset-source/` to support reliable source transfers. The build restores the original files and verifies their SHA-256 checksums before compiling.
