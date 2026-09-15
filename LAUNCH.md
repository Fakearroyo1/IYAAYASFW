# Launch the password-based store on Cloudflare

The original Sites app remains online at iyaayasfw.com. These steps first deploy a separate working copy to a Cloudflare workers.dev address. Do not change DNS or delete the Sites domain while setting up.

## 1. Verify existing resources

Cloudflare account → Storage & databases → D1 → iyaayasfw-supply-db.
Copy its Database ID for the private build variable below. Account-specific IDs are intentionally absent from GitHub.
In its Console, run:

```sql
SELECT COUNT(*) AS products FROM products;
SELECT email AS owner_email FROM members WHERE role='admin' AND active=1;
```

The imported snapshot originally had 12 products and one owner. Use that owner email in the Worker secret below. It is not a live replica of the Sites data. Do not reimport or reset the database.

Open R2 Object Storage and confirm a private bucket named iyaayasfw-supply-images exists. If it does not, create it. Cloudflare may require billing setup for R2.

Password hashing requires more CPU than the Workers Free per-request allowance. Use a Workers plan with sufficient CPU allowance; review and accept Cloudflare's displayed costs yourself. The Worker is configured for a maximum 30-second CPU budget; this does not mean every request uses 30 seconds.

## 2. Deploy from GitHub

1. Cloudflare → Workers & Pages → Create application → Import a repository.
2. Connect GitHub and select Fakearroyo1/IYAAYASFW.
3. Select the branch **main** (production branch). If the wizard only offers main, change the branch under Settings → Builds before deploying this project.
4. Worker name: iyaayasfw-supply.
5. Build command: `pnpm run build`.
6. Deploy command: `pnpm run deploy`.
7. Root directory: repository root.
8. Leave dependency installation enabled; use Node 22 and PNPM_VERSION 11.25.0 if build variables are needed.
9. Under Settings → Builds → Build Variables and Secrets, set `CLOUDFLARE_D1_DATABASE_ID` to the existing database ID you copied. Treat it as a secret build variable. Do not put it in GitHub.
10. The build/deploy credential must be allowed to deploy Workers and execute D1 statements, with the configured R2/D1 bindings available in this account.
11. Save and deploy. The deploy command creates the additional login tables without changing the store records.

If Cloudflare offers a separate non-production deploy command, do not use it to launch the store. Keep this branch as the production branch of the new Worker.

## 3. Set your first owner password

1. Open the new Worker → Settings → Variables and Secrets → Add.
2. Choose **Secret**.
3. Add a secret named `OWNER_EMAIL`, using the email from your existing owner record.
4. Add a second secret named `BOOTSTRAP_PASSWORD`. Its value: a unique password of at least 15 characters that you choose. A password-manager-generated password is suitable. Do not paste it into chat, GitHub, or a document.
5. Save and deploy the configuration change.
6. Open the Worker's workers.dev URL → log in with YOUR_OWNER_EMAIL and that password.
7. After the first successful login, remove BOOTSTRAP_PASSWORD from the Worker secrets and deploy the configuration change. Your stored hashed password continues to work.

The bootstrap secret works only when the existing owner has no password hash. It does not create an owner from a publicly supplied email and it cannot override an existing password.

Do not configure Cloudflare Access in front of this Worker for member login. If an Access application from the earlier guide covers the eventual domain, it must be removed from that hostname at cutover; otherwise it will add a second login gate.

## 4. Add a test member

1. Manage → Members → Add member.
2. Enter their name and approved email, configure any opening balance with its source/reason, and save.
3. Select Setup code. Generate a private code and share it directly with the intended member. They select First Time, enter their whitelisted email and setup code, and choose a password of at least 15 characters.
4. Test sign-in on another device. Verify the member sees only their own balance and purchases, and cannot see Manage.
5. Close/reopen the browser and confirm the session persists.
6. Test Sign out devices and confirm a new sign-in is required.
7. Test disabling the account and confirm it cannot sign in.

Members can change their password from My account after providing the current password. Forgot password sends a request to the in-app admin queue. Administrators can replace a forgotten password without retrieving the old one. Purchasing access is configured separately for Snack bar and Unit gear.

## 5. Refresh records and switch the domain

Do this only after the test deployment works:

1. Pause checkout on the original Sites app during the final transfer window.
2. Capture a fresh full database backup and every uploaded product image. CSV is useful for accounting but is not a complete database backup.
3. Reconcile/transfer changes made since the September 14 import. Preserve member IDs, order IDs, payment IDs, and references; avoid duplicates. Keep the new authentication tables intact when updating store records.
4. Verify products, members, purchase/payment counts, balances, images, and exports on the Cloudflare copy.
5. In the source wrangler.json, set `workers_dev` to false and replace the empty routes array with:

```json
"routes": [{"pattern":"iyaayasfw.com","custom_domain":true}]
```

6. Remove the custom-domain connection from Sites while preserving the Sites app. Save the current DNS configuration for rollback. Remove only the conflicting root routing records when Cloudflare requires it; preserve email records and unrelated subdomains.
7. Deploy the updated Worker configuration. Verify the custom domain under Worker → Settings → Domains & Routes, including HTTPS.
8. If an old Cloudflare Access policy covers iyaayasfw.com, remove that hostname from the old policy so the app's own login is used.
9. Test login, member isolation, images, checkout, and exports at iyaayasfw.com, then enable checkout there. Keep the original app's checkout paused to avoid splitting records.

The workers.dev and custom-domain cookies are separate. Members will sign in once again at the final domain after cutover.

## Owner recovery

If the sole owner forgets their password, use your authenticated Cloudflare account to reset it; there is no public recovery endpoint. Set a new BOOTSTRAP_PASSWORD secret, then remove the owner's sessions and credential through D1 Console (do not remove the member or financial records):

```sql
DELETE FROM auth_sessions WHERE member_id IN (SELECT id FROM members WHERE email='YOUR_OWNER_EMAIL');
DELETE FROM auth_credentials WHERE member_id IN (SELECT id FROM members WHERE email='YOUR_OWNER_EMAIL');
```

Log in with the new secret, then remove the secret again. Use this procedure only for deliberate owner recovery.
