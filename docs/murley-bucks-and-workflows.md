# Murley Bucks and everyday admin workflows

This guide describes the spending rewards and workflow update. Administrators still sign in to the main store and complete **Verify access** before using management controls. Guest shopping remains on `gear.iyaayasfw.com`.

## Start at the dashboard

Open **Manage → Dashboard**. The cards lead to payment confirmations, member support, stock checks, fulfillment, community reviews, and team follow-up. A count is work to review, not proof that money was received or an order was fulfilled.

The management menu groups related tools:

| Group | Tools |
| --- | --- |
| Start here | Dashboard; Needs attention |
| Money | Confirm payments; Transactions & corrections; Month close |
| Products & orders | Products & stock; Restock & counts; Pricing; Fulfillment; Guest campaigns; Trials & interest |
| Members & community | Members & access; Email changes; Murley Bucks & profiles; Community moderation |
| Store operations | Team board; Activity history; Store settings |

On smaller screens, use the grouped **Management section** dropdown. **Find a management tool** on the dashboard provides another direct route to these tools.

## How purchase earning works

Members earn **1 Murley Buck per $1 of eligible paid merchandise**, including snacks and gear. Fractional dollars carry forward: $2.75 followed by $1.25 earns four points in total, subject to any earning cap.

| Activity | What happens |
| --- | --- |
| Add a snack purchase to a tab | Its eligible earnings remain pending until the purchase is paid. |
| Admin confirms a tab payment | The payment pays down older debt first; eligible new purchases then earn points as their debt is paid. |
| Admin confirms cash or Cash App for a new gear purchase | Its paid eligible merchandise earns points. |
| Spend ordinary confirmed account credit | The eligible merchandise funded by that credit earns points immediately. |
| Deposit credit or overpay cash | The deposit itself earns nothing. Eligible spending earns later. |
| Spend credit obtained by redeeming Murley Bucks | That funding earns no new spending points. Reward-derived credit is used first when account credit is spent. |
| Refund or correct a purchase | Related spending points are recalculated and reversed as appropriate. |

Tax and shipping do not earn points. Neither guest purchases nor manually forgiven debt earn member spending points. The site tracks partial payments and credit funding; do not add a second manual award for the same purchase.

Earning starts with this release's recorded start time. Existing purchases and debt are preserved and **are not backfilled**, even if an old payment is confirmed later. Paying down old debt does not retroactively earn purchase points. Existing earned Murley Bucks remain available; manual recognition can still acknowledge a past contribution.

The old fixed daily purchase bonus is replaced by dollar-based earning. Manual awards and other enabled participation rules continue.

The separate on-time tab-settlement award recognizes the payment behavior and remains after a legitimate merchandise refund. A tab cycle funded with reward-derived credit does not receive that award. Reward-funded returns must go back to account credit; purchases involving a manual tab write-off require payment review before an external refund.

### Understand the balances

Members open **Recognition → My Murley Bucks** to see:

- **Historical earned:** earned recognition after recorded adjustments. Profile unlocks use earned recognition; season standings use earnings during that season.
- **Available to spend:** earned Murley Bucks minus rewards already redeemed.
- **Spent on rewards:** points used for issued rewards.
- **Pending payment:** potential purchase earnings awaiting eligible payment; these cannot be spent yet.

Redeeming points does not lower earned recognition, profile unlocks, or Support Board standing. A refund or manual deduction can lower earned recognition. If that happens after points were spent, available points can become negative; new earnings cover that amount before another redemption is allowed.

### Set an earning cap

1. Open **Manage → Murley Bucks & profiles → Rules & tiers**.
2. Find **Purchase earning → Weekly spending limit**.
3. Set **Maximum spending Murley Bucks per week**. `0` means no cap and is the initial setting.
4. Enter the reason for the change and save.

Weeks start Monday in UTC. The cap is fixed when a member first earns during a week; a changed setting applies to their next new earning week. Participation-rule caps are separate. The purchase rate is currently fixed at 1 point per $1; this control changes the cap, not that rate.

### Give manual recognition

1. Open **Member recognition** in the same admin area.
2. Select the member.
3. Under **Recognize a contribution**, choose **Manual award / deduction** or the appropriate participation rule.
4. Enter the amount for a manual award, or the contribution reference for a rule-based award.
5. Enter a useful reason and save.

Manual amounts can be positive or negative. Use the ledger's **Record reversal** for an erroneous award so its original record remains visible. **Reward account controls** can pause automatic awards and redemption while an issue is investigated.

## Publish rewards members can choose

No store-credit offers or raffles are activated by deployment. Administrators decide the exchange terms and when an offer becomes available.

1. Open **Manage → Murley Bucks & profiles → Rewards & raffles → Reward catalog**.
2. Select **Create reward**.
3. Enter a name, description, and **Murley Bucks per redemption**.
4. Choose **Account credit** or **Raffle tickets**.
5. For credit, set the dollars awarded per redemption. For tickets, choose an existing raffle and tickets per redemption.
6. Optionally set a **Total redemption limit**. This limits the number of redemptions across all members; blank means unlimited.
7. Save inactive while reviewing the terms. Enable **Active** when ready, or use **Activate** on its card.

Members use **Recognition → Use Murley Bucks → Choose reward**, review the quantity and total, then **Confirm redemption**. Account credit is issued immediately under the administrator-published terms. It does not require a second payment confirmation; members choose when to use it for a purchase or tab payment. Raffle redemptions immediately issue numbered tickets.

Use **Redemption activity** to review issued rewards. Deactivating an offer stops new redemptions without deleting history. Changing the exchange terms after an offer has issued rewards requires a reason and affects future redemptions only. Issued redemptions are permanent records; there is no cancel-redemption button. Reward-derived credit cannot be refunded as cash.

## Run a raffle

1. Open **Rewards & raffles → Raffles → Create raffle**.
2. Enter the event and prize description, opening/closing times, and drawing method:
   - **Website random draw:** the site selects one issued ticket.
   - **Outside draw + ticket export:** conduct the draw using exported ticket numbers, then record the winning number.
3. Save inactive until ready. Activate the event when its entry window should be available.
4. If members may exchange points for tickets, create and activate a separate raffle-ticket reward in **Reward catalog** linked to this event.
5. Select **Manage entries** on the raffle to inspect its roster.

**Add a free entry** supports either an active site member or a **Visitor without an account**. Enter the participant and ticket quantity, then **Add free tickets**. This does not create an account, charge money, or create a purchase. Visitor details stay in administrator event records. Members see their own ticket numbers under **Use Murley Bucks**.

For a website draw, choose **Draw a winner…**, review the event and ticket total, then **Draw and close raffle**. For an outside draw, choose **Pause entries for the draw**, **Export all tickets**, conduct the draw from that final list, then **Record outside winner…**. Enter the winning ticket and a result reference before selecting **Save winner and close**. Re-export if entries are reopened or changed.

A drawing records one final winner and cannot be rerun. Its method and entry window are fixed after tickets are issued. If members have entered, a current unarchived recognition season must exist before drawing. A member winner receives a **Raffle Winner** badge through the end of that season; it displays automatically without consuming a chosen badge slot. Visitor winners remain in the event record.

## Profiles, requests, and member recognition

Profiles and Support Board participation are enabled by default for new profiles. Existing saved privacy choices and moderation restrictions are preserved.

Members can use **Recognition → My profile** to change their **Display name / call sign**, select earned customization, and save. Their actual member name remains visible when a signed-in member opens the profile. **My account** also displays their profile, flair, and rewards balance. Requests show approved profile flair and a clickable profile identity.

Changes to the display name, bio, or uploaded images wait for review while the last approved content remains visible. Administrators use **Manage → Murley Bucks & profiles → Profile moderation** to approve or hide content. Routine approval needs no filler explanation; hiding a profile or removing images requires a moderation reason.

Members can disable **Let signed-in members see my approved profile**, **Include me on the Support Board when my profile is visible**, or both. Saving a privacy change takes effect without waiting for approval. Hidden/private profiles do not expose customization through request cards.

## Clear team follow-up without clearing business records

In **Needs attention**, select task checkboxes or **Select visible tasks**; a batch is limited to 50 tasks. Then choose:

| Action | Effect |
| --- | --- |
| Assign | Assigns selected open tasks to an administrator or leaves them unassigned. |
| Snooze | Hides reminders from the open list for 1, 3, or 7 days. They remain under **Snoozed** and in dashboard totals. |
| Restore reminders | Returns snoozed tasks to the open list. |
| Mark adjustments reviewed | Clears review notifications for recorded adjustments only. |

Read the confirmation summary before applying. Changed or ineligible records are skipped and counted in the result. A snoozed task returns when its source details change or its snooze expires.

These actions never confirm money, forgive tabs, adjust stock, approve access, or fulfill orders. Complete those actions in their owning tool. Use bulk review for already-reviewed beta adjustment notifications; use **Transactions & corrections** when an actual mistaken transaction needs correction.

## Campaign codes and shorter routine forms

Open **Manage → Guest campaigns → Create campaign**. Configure its dates and products, then choose **Generate an easy-to-read code** or **Use my own phrase or code**. The first code is issued when the campaign is saved; copy it from the success message. Custom codes require at least eight letters or numbers, within 64 total characters. Capitalization, spaces, and hyphens do not matter at entry.

Use **Change campaign code** on an existing campaign to replace its code. Replacing or revoking a code signs out its campaign sessions; saved receipt access remains available. Revocation without replacement requires a reason.

Routine configuration, assignment, and normal fulfillment no longer require filler notes. Actor, time, and the change still enter history automatically. Explanations remain required for accountable exceptions such as balances, corrections, stock losses, reward adjustments, reopened months, security restrictions, reservation overrides, and externally recorded draw results.

## Cash App payment handoff

Members select **Copy reference & open Cash App**. The site copies the payment reference and opens Cash App with the amount. They still paste the copied reference into the payment note, send the payment, and return to the site to finish its payment-reporting step.

If clipboard access or the popup is blocked, the site displays a selectable reference and a separate **Open Cash App** link. Opening Cash App does not report or confirm payment. Admins continue matching the real payment and entering its Cash App transaction ID under **Confirm payments**.

## Release and first-use checklist

The new earning, redemption, profile, and admin-workflow migrations add supporting records and controls. They preserve sales, payments, balances, stock, past points, badges, and audit history; they do not reset or backfill the store. New reward definitions and raffle events begin inactive until an administrator enables them.

Before announcing rewards:

1. Review the earning start date and weekly cap under **Rules & tiers**.
2. Set and review the first credit reward's point cost, dollar value, and total limit; then activate it.
3. For raffles, create the event, verify the current season, and activate the ticket offer only when ready.
4. Check **Redemption activity** and the member-facing **Use Murley Bucks** view after the first legitimate redemption.
5. Remind the team that purchase/payment workflows remain authoritative; notification review and rewards never replace financial confirmation.
