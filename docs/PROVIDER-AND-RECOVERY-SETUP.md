# Owner setup for the identity test release

Target: September 21, 2026, 08:00 America/New_York. These steps prepare access; they do not enable a new login method or authorize messages to members. Jake is the sole custodian. Never paste secrets or recovery codes into chat, an issue, or Git.

## Google member login

In [Google Cloud Console](https://console.cloud.google.com/), create/select a project named **IYAAYASFW member login**. Configure Google Auth Platform branding and an External audience for personal accounts. Use your existing controlled support contact; do not invent a recovery address. Request only `openid`, `email`, and `profile`. Basic sign-in does not require Gmail, Drive, or Calendar permissions.

Create an OAuth client of type **Web application**, with exactly this authorized redirect URI:

`https://auth.iyaayasfw.com/oidc/google/callback`

For initial owner testing, use Testing audience and explicitly add your own Google account as a test user. All approved members require the provider audience to permit their accounts before rollout; application membership still controls access. Configure a separate client for any isolated test environment; do not add wildcard callbacks.

In Cloudflare → Workers & Pages → **iyaayasfw-supply** → Settings → Variables and Secrets, enter the client ID as `GOOGLE_CLIENT_ID` and the client secret as an encrypted secret named `GOOGLE_CLIENT_SECRET`. Keep new method flags off. Save a recoverable copy of the client registration details in your own secure vault.

### Branding and account-change verification

The public branding pages are `/about` and `/privacy`; the member store remains private. In Google Auth Platform → Branding, use the exact app name **IYAAYASFW member login**, homepage **https://iyaayasfw.com/about**, and privacy policy **https://iyaayasfw.com/privacy**. Retain the owner's real controlled support contact. Verify `iyaayasfw.com` in Google Search Console with the Google account authorized for this project. The owner reported ownership verification complete on September 21. Once both pages are deployed and these fields are saved, choose **I have fixed the issues** in Verification Center and request re-verification. Domain verification alone does not establish branding approval.

Ordinary Google sign-in and linking remain supported. Google-based fresh verification for account changes is separately gated by `IDENTITY_GOOGLE_FRESH_ENABLED`, default `false`. Use an existing password, passkey or linked personal Microsoft account while this gate is off. The owner reported branding rejection prevented access to Advanced Settings; two real fresh callbacks lacked an acceptable authentication-time claim.

After Google approves branding and the app meets its published/verified requirements, enable **Settings → Advanced Settings → Session age claims**. The implementation explicitly requests `claims={"id_token":{"auth_time":{"essential":true}}}` for fresh verification. A signed `auth_time` within five minutes is still required. Google does not support requesting Google Account reauthentication; choosing an account or issuing a new ID token is not fresh proof. Enable the app's fresh-Google flag only through a checked release and complete a real account-change test. If the Google session is older, use another linked method.

References: [Google branding requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification), [public homepage requirements](https://support.google.com/cloud/answer/13807376?hl=en), [session age claims](https://developers.google.com/identity/siwg/security-bundle), [explicit claim request](https://developers.google.com/identity/openid-connect/reference).

## Personal Microsoft member login

In [Microsoft Entra admin center](https://entra.microsoft.com/), open App registrations → New registration. Name it **IYAAYASFW member login** and choose **Personal Microsoft accounts only**. This does not require members to have organizational, military, or government accounts. If your owner account cannot create a registration, report that console limitation; do not select a broader audience as a workaround.

Add a **Web** redirect URI exactly:

`https://auth.iyaayasfw.com/oidc/microsoft/callback`

Create a client secret with an expiration you can track securely. Put the Application (client) ID in Cloudflare as `MICROSOFT_CLIENT_ID` and the secret **value** as encrypted `MICROSOFT_CLIENT_SECRET`. The runtime will use the consumer authority and only `openid email profile`; no Graph/mail access or refresh-token permission is needed. Email-based automatic association remains disabled. Invites and freshly authenticated linking can associate a personal Microsoft account without assuming that its email matches the roster.

If Microsoft displays `unauthorized_client` and says the app does not exist or is not enabled for consumers, check the registration's **Overview → Application (client) ID** and **Supported account types** first. The Object ID and the Secret ID are different identifiers and must not be used as the client ID. This project requires **Personal Microsoft accounts only**. Keep the callback under the **Web** platform as shown above. If the current registration cannot support personal accounts, report the console limitation before replacing it. Do not switch the app to organizational sign-in or change its consumer endpoint to conceal the failure. See [Microsoft's account-type configuration guidance](https://learn.microsoft.com/en-us/entra/identity-platform/howto-modify-supported-accounts).

## Solo recovery custody

Use your existing secured recovery methods for Cloudflare, GitHub, Google, and Microsoft. Verify that you can recover those accounts independently of the snackbar app. Keep account recovery codes, backup encryption material, and the location of encrypted backup copies under your control in a secure vault plus an offline/recoverable copy. Do not store the only key beside its encrypted backup, in app storage, or in this repository.

Before exporting real records, identify an owner-controlled **encrypted backup destination** and a separate **key custody location**. Only describe categories/paths, never the key itself. A protected backup and restricted restore rehearsal are release gates. No production restore is authorized by these instructions.

## Tell Codex when ready

Report only: project/application names, whether each registration exists, whether the four Cloudflare settings above are saved, and any console error. Also report which recovery methods are available and the approved backup/key locations by category. Do not report secret values. Real provider sign-in, phone passkey tests, MFA denial, and recovery still need evidence before rollout.

References: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Microsoft registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).
