# Gear management and everyday purchasing

Baseline: production main `76352c42b09fe8a7c910386a33b0fed8dc3fef3a` (PR #12).
Scope: roadmap rounds 1 and 2. No schema migration, backfill, reset, seed changes, or production test transactions.

## Workflow review

| Finding | Change |
| --- | --- |
| Gear creation, descriptions, options, and prices required separate editors and separate commits. | Inventory → New gear item / Manage gear opens one complete editor. Pricing hub links gear into this same workspace. |
| Parent stock was displayed before a required option was selected. | Selection now drives price, stock, and preorder mode. An unselected product asks for an option; unassigned stock cannot make a size purchasable. |
| Product details returned members to the shop instead of opening their bag. | Both bag links open the editable checkout sheet directly. |
| Mobile users could not fix quantities or remove a stale item in checkout. | Shared editable bag controls, explicit price acceptance, and removable unavailable lines work in the sidebar and checkout. |
| Repeat purchases required finding the same snacks each visit. | Buy Again returns up to six product IDs from that member’s effective purchase history and resolves the current accessible catalog. |
| Home-screen installation had no in-app guidance. | Account includes a supported browser install prompt or device-specific instructions, using the existing brand icon and manifest. |

## Gear save contract

- `saveGear` requires current administrator identity and Cloudflare Access verification, the existing same-origin JSON check, rate limits, and idempotency key.
- Product/details/option metadata and prices save in a single guarded D1 batch, with before/after audit history. New IDs are stable across retries.
- Existing product and option IDs, stock, purchases, and fulfillment records are preserved. Recorded cost fields affect future sales only and do not fabricate an expense. Metadata saves do not write existing stock; a concurrent sale can safely complete without being overwritten.
- Version checks reject stale metadata/count/price changes. Existing options are hidden rather than removed. Swapping labels preserves option identities.
- Drafts use the established `active=0` visibility state. Publishing validates tax and every active option’s effective price. Archived products must be restored first.
- New opening counts require an audit reason and do not fabricate a supplier expense. Receiving, allocation, and count corrections remain explicit inventory actions in the workspace.
- An administrator with current MFA can submit a bounded 64 KB option matrix. Members and unverified administrators retain the 24 KB bound. Maximum 80 options, 9 images, and all existing field bounds remain enforced.
- Failed saves retain form inputs. A confirmed retry resets the editor to the saved version. Enter on a published item saves it without implicitly hiding it.

## Member purchasing contract

- Snacks remain tab-first, with the $20 reminder and $30 hard cap (or stricter member limit). Members choose whether to apply confirmed credit.
- Gear and preorders retain immediate cash/Cash App reporting or credit, followed by administrator payment confirmation before fulfillment.
- Buy Again excludes voided/fully corrected purchases, inaccessible shops, archived products, and hidden products; unavailable current products cannot be added. No other member’s history is returned.
- A mixed bag checks out each shop separately. It opens a valid shop when one side needs correction; other items remain in the bag.
- Personalized lines share a variant’s stock limit. Changed gear prices require acceptance before checkout. Removed/hidden products remain removable from the bag without exposing their catalog details.
- Installation requires no camera, scanner, or offline purchase mode. No service worker or cache of authenticated records was introduced. The existing logo is reused unchanged.

## Validation

New regression suites cover full draft/publish/edit flows, option pricing, stock/preorders, original-record preservation, stale changes, repeated requests, authorization, large matrices, and member catalog privacy. The HTTP suite uses the actual compiled Worker and disposable D1, including a last-option purchase race.

Existing financial, authentication, hardening, bounded-body, image-parser, and backup suites remain required in CI, together with dependency audit and secret scanning. New UI checks render the real gear, bag, installation, and checkout components and test both theme contrast palettes.

Limitation: the supported cloud browser cannot open the isolated local preview (`ERR_BLOCKED_BY_CLIENT`), so interactive screenshots of the new authenticated screens were not verified. No attempt was made to bypass that restriction or weaken production authentication for testing.

## Deployment / rollback

Publish through protected main after required checks. Confirm **Workers Builds: iyaayasfw-supply**, not the legacy Pages check. Existing runtime secrets, custom domain, MFA policy and bindings stay unchanged. Rollback can redeploy the previous Worker version; all persisted changes use already-supported schema fields and retain historical records.
