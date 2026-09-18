# Connect the guest gear storefront

The release adds a separate Worker, `iyaayasfw-gear`, for `gear.iyaayasfw.com`. Its code, shipping checkout, shared inventory, reservation cleanup, and domain configuration are in this repository. The member site remains `iyaayasfw-supply` at `iyaayasfw.com`.

Complete these steps after the member site's new deployment succeeds. Guest ordering starts closed. Creating the guest Worker does not open campaigns or change existing balances or stock.

## 1. Create the separate Worker and connect GitHub

1. Open Cloudflare → **Workers & Pages** → **Create application**.
2. Choose the GitHub repository import/connection option, then select **Fakearroyo1/IYAAYASFW**.
3. Name the Worker **iyaayasfw-gear**. Keep the existing `iyaayasfw-supply` project unchanged.
4. Set the following values. If Cloudflare first creates the Worker, edit them under that Worker's **Settings → Builds** before retrying the build.

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | Repository root (`/`) |
| Build command | `pnpm run build:gear` |
| Deploy command | `pnpm run deploy:gear` |
| Builds for non-production branches | Off |
| Build variable `NODE_VERSION` | `22` |
| Build variable `PNPM_VERSION` | `11.25.0` |
| Build variable `CLOUDFLARE_D1_DATABASE_ID` | `ed7e63c8-77fd-4314-ab35-131c061e016a` |

The build script uses `gear/wrangler.json`; the deploy script verifies the existing database and guest schema before uploading. Both commands belong on the **gear Worker's build**, not the member Worker's build. Cloudflare's CI identity check intentionally prevents a build assigned to one Worker from silently deploying another.

Cloudflare supports configurable build/deploy commands and GitHub deployments. Build variables apply on the next build; they are separate from runtime secrets. [Build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/).

## 2. Select a build token and deploy

Use a build API token scoped to this account and the `iyaayasfw.com` zone with the permissions required by this deployment:

- Account: **Workers Scripts — Edit**, **D1 — Edit**, **Workers R2 Storage — Edit**.
- Zone: **Workers Routes — Edit**.

Cloudflare's automatically generated build token may need D1 permission added under **My Profile → API Tokens → the selected build token → Edit**. The deploy script runs a read-only D1 query before uploading. Save the build settings, then run/retry the latest `main` build. [Build token configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Confirm the log says the Worker uploaded and its triggers deployed. The database and bucket bindings are supplied by the repository:

| Binding | Existing resource |
| --- | --- |
| `DB` | `iyaayasfw-supply-db` |
| `BUCKET` | `iyaayasfw-supply-images` |

No new database, catalog copy, or image bucket is needed.

## 3. Add the runtime signing secret

1. Select **iyaayasfw-gear → Settings → Variables and Secrets**.
2. Click **Add** and choose **Secret**.
3. Name it **GEAR_SESSION_SECRET**.
4. Generate a new random 64-character value in your password manager and paste it into **Value**. This application requires at least 32 characters.
5. Click **Deploy** and confirm the new version is active.

Use the Worker's runtime section here. A value entered only under **Builds → Variables and secrets** is unavailable to visiting guests. Without the runtime secret, the storefront stays closed. Keep the value private; it is not a campaign code. [Cloudflare runtime secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## 4. Verify the domain

Open **iyaayasfw-gear → Settings → Domains & Routes**. The repository declares `gear.iyaayasfw.com` as a Custom Domain, so the successful deployment should create it. If it is absent, choose **Add → Custom domain**, enter `gear.iyaayasfw.com`, and complete the prompts. Cloudflare manages its DNS and certificate. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

If deployment reports that the hostname has externally managed DNS records, inspect **iyaayasfw.com → DNS → Records**. Remove only a confirmed obsolete web record for the exact hostname **gear.iyaayasfw.com**, then retry. Preserve the root domain, mail records, and other applications. Do not point `gear` to the member Worker.

The guest host uses campaign codes and private receipt keys; admin controls still require member login and Cloudflare Access verification at the main site. Keep the existing admin Access application and policy intact. If an unrelated wildcard Access application covers `gear`, review its hostname scope before inviting guests.

## 5. Prepare and open a campaign

1. Sign in at `iyaayasfw.com`, verify admin access, and open **Manage**.
2. In **Inventory → Gear Manager**, configure the gear products/options and personalization. Set pickup/shipping availability and each option's first-item/additional-item shipping charges.
3. Open **Guest gear → Campaigns → Create campaign**. Select existing gear options, quantities, opening/closing dates, reservation duration, pickup information, and any shipping cap/free-shipping threshold.
4. Save, then **Rotate / revoke code** to issue the initial code with a reason. Save the code when displayed; the database retains only its hash. Rotating it invalidates previous campaign sessions.
5. Under **Store availability**, enable guest ordering and save with a note.
6. Open `https://gear.iyaayasfw.com` in a separate browser and enter the campaign code. Verify product details and delivery quotes before sharing the code.

Shipping supports the 50 US states and DC. Military addresses, US territories, and international shipping are not included in this release. Pickup is free. Mixed-item shipping uses the highest first-item charge once, plus the applicable additional-unit charges, then the configured cap/threshold.

Guests report cash or Cash App payment immediately. Admins confirm payment in **Payments/Transactions** before fulfillment in **Guest gear → Orders & fulfillment**. The same transaction tools handle partial/full refunds and corrections with history. Pending reservations expire automatically; confirmed paid orders do not. Use the member site's **Guest gear** switch to pause new ordering.

## Updates and recovery

Future commits on `main` deploy both connected Workers. Keep the two sets of build commands distinct. The main deploy owns schema migrations; the gear deploy only checks that the schema exists. If a gear build races a new schema migration, retry it after the main build succeeds.

If a guest-only release needs rollback, close guest ordering first and roll back its Worker code. Do not drop tables, restore old inventory, or erase payment/reward history. Main-site features do not require the guest host to be open.
