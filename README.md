# IYAAYASFW Supply

A member store for snack bar purchases and unit gear, with durable orders, stock and price management, pickup tracking, and CSV exports. Production is hosted on the existing Cloudflare Worker at iyaayasfw.com; `main` triggers Workers Builds.

## Member access and passwords

- Manage → Members approves an email and grants Snack bar, Unit gear, or both. Existing members default to both without rewriting their records. Gear-only accounts do not receive snack catalog data and cannot purchase snacks through the API.
- Administrators can manage both shops. The owner grants administrator roles and manages other administrators. The owner cannot be disabled or demoted.
- New members use **First Time** on the login page. Only an active approved email without a password can proceed. An administrator issues a private setup code from Members and shares it with the intended member. Codes expire after seven days, are stored only as hashes, and are consumed when a password is created. A new code invalidates the previous one. Knowing a whitelisted email alone cannot claim the account.
- My account → Change password requires the current password. The current device stays signed in; other sessions are revoked.
- Forgot password creates one pending in-app request per active account. Administrators review requests in Members, assign a replacement privately, and the request is resolved automatically. Requests do not themselves grant access. An administrator can dismiss a request without changing a password.
- Passwords use scrypt (N=16384, r=8, p=5), 15–128 characters, and are never stored in plaintext or returned. Setup codes and passwords are absent from audit logs.
- Sessions use random 256-bit tokens stored only as hashes, with Secure, HttpOnly, SameSite=Lax, host-only cookies. Password replacement, role/access changes, deactivation, device revocation, and logout invalidate sessions as appropriate.
- Authentication has per-IP and per-account limits. Mutations require same-origin requests. Authorization is enforced again within write transactions.

## Gear and inventory

- Inventory manages product information, stock, and availability. Selling prices and costs have their own Pricing hub.
- Gear tiles open `/products/:id`, with a main image, up to eight additional images, description, options, personalization, and pickup instructions.
- Manage gear includes shirt, hoodie, and name-tape option presets plus custom sizes/colors. Options can have their own prices, stock, and preorder status. A blank option price inherits the base price.
- New options start at zero stock. Existing product stock remains unassigned until explicitly allocated to an option. Allocation transfers units without creating an expense or duplicating stock.
- Receive records new stock and allocated receipt cost, including freight, purchase tax/fees, and discounts. Weighted cost remains unknown when existing units have unknown cost.
- Gear order lines retain the purchased option label, personalization, quantity, unit price, cost, and tax. Later product changes do not rewrite them. Voiding a pending purchase restores the correct option's stock.
- Manage → Pickups tracks awaiting stock, ready for pickup, and picked up. Payment is separate; an order must be paid before pickup can be marked complete. Existing gear orders are not backfilled or assumed fulfilled.
- Archive hides products without deleting stock or purchase history. Existing options can be hidden rather than deleted.

## Pricing and reports

- Pricing compares recorded unit cost with an adjustable case/quantity/landed-cost calculator. Suggested prices use gross margin after included sales tax.
- Snack price changes round **up** to $0.25 increments. Existing prices stay unchanged until an administrator explicitly applies a new price.
- Applying a price never changes inventory or past orders. Updating recorded cost is a separate opt-in for future purchases.
- Item performance uses original order-item snapshots, excludes voids, distinguishes paid-order sales, and shows sales tax, restock spending, and price/restock history by date range. Unknown historical cost is identified; it is not estimated from current cost. Sales can include unpaid and unfulfilled preorders.
- CSV exports include item options, personalization, pickup status, purchasing permissions, and an option-inventory snapshot. Text is escaped to prevent spreadsheet formula injection.

## Deployment and preservation

Follow [LAUNCH.md](LAUNCH.md) for account setup. No real credentials or production-record snapshot belongs in this public repository. Keep OWNER_EMAIL and authentication secrets in Worker runtime settings. CLOUDFLARE_D1_DATABASE_ID remains a private build variable.

`pnpm run deploy` executes only the idempotent `AUTH-SCHEMA.sql` and `PRODUCT-SCHEMA.sql` tables/indexes before deploying. It does not import a database snapshot, seed records, change existing prices, or reopen the shop. `SHOP-READY.sql` is an earlier one-time repair and is no longer executed by deployment. Never rerun the initial `drizzle` schema on an initialized production database.

Order and option writes use JSON batches to keep larger orders within [D1's query limits](https://developers.cloudflare.com/d1/platform/limits/). Stock and authorization guards execute in the same transaction as writes. Purchase requests and administrative mutations retain idempotency identifiers.

## Development and verification

Use Node 22.13+ and the pnpm version pinned in package.json.

```
pnpm install --frozen-lockfile
pnpm run typecheck
node tests/pilot.mjs
pnpm run build
TMPDIR=/dev/shm node tests/auth-integration.mjs
```

Tests use synthetic isolated SQLite or Workers D1/R2 storage and never connect to production. They cover preservation across repeated schema application, access restrictions, setup-code activation, password changes and recovery, pricing calculations, option stock, personalization, order retries, voids, and pickup/payment separation.

Product images under `asset-source/` are restored and checksum-verified during each build. Uploaded product photos remain in the existing R2 bucket.

## Security checks and deployment review

Run `pnpm run typecheck`, `node tests/pilot.mjs`, `node tests/http-security.mjs`,
`pnpm run build`, `node tests/auth-integration.mjs`, and `node tests/security.mjs`.
The security suite uses disposable Workers D1/R2 instances and synthetic users.
It never sends traffic to the production domain.

Member sessions expire after seven inactive days or thirty days total. Admin
sessions expire after thirty inactive minutes or twelve hours total. Expiration
is checked on the server; existing stored passwords and business records remain.
Passwords created or replaced are screened against a local common-password list.

The Worker entry applies a nonce-based script CSP, framing protection, HSTS,
private no-store responses, and blocks unused Server Actions/image optimization.
Product images use the existing authenticated image endpoint and static assets.
Keep the workers.dev and preview URLs disabled when using the custom domain.

Member writes are limited to 30/minute; administrator writes 90/minute. Reads are
limited to 120/minute per member. Uploads allow 10/minute per administrator.
Each member can have at most five unreviewed standalone payment reports and twenty
unreviewed cash/Cash App purchases. Confirm/reject existing reports to clear the
backlog. Existing reports are retained, and idempotent checkout retries remain safe.
These application limits supplement edge protection; they do not replace a WAF,
Cloudflare Access/MFA, or Turnstile.

Dependency audits deliberately report all remaining advisories. At 2026-09-15,
image-size 2.0.3 is younger than the configured seven-day release waiting period.
Its two remaining parser advisories concern the build-time dependency; the app
has no static JS image imports, and the unused optimizer endpoints are blocked.
Review and install the patch after the release waiting period. Do not bypass the
waiting policy or mistake a development dependency classification for proof that
code cannot be bundled into production.
