# Rewards and workflow release handoff

## Recovered work

The Website Development conversation in the Snack bar / Military Org project reached its chat limit before publication. Its implementation was recovered intact from local commit `094ae854a33fd47f03d30f05548c4849698c985a`, based on production commit `d2dfc236f3abe377f715e01420c41974d6b25d3e`. That implementation had not reached GitHub when recovery began.

The production source is `Fakearroyo1/IYAAYASFW`. The main and guest stores deploy through the existing Cloudflare Workers Builds integration after changes reach `main`. The separate Sites review sandbox contains synthetic data for visual review; it is not the production database or deployment.

## Approved decisions

- Earn one Murley Buck per eligible merchandise dollar after confirmed payment. Exclude tax, shipping, and reward-funded credit; carry fractional dollars forward.
- Replace the fixed purchase bonus while retaining eligible tab-settlement, community, and manual awards. The configurable weekly purchase cap initially has no limit.
- Preserve existing earned points as spendable points and do not recalculate historical purchases. Separate historical earned, available, spent, and pending balances. Redemption does not reduce Support Board recognition or profile unlocks.
- Let admins define and activate credit rewards and raffle-ticket rewards. Credit issues immediately and can fund tabs or new purchases. Keep permanent redemption history.
- Support website draws and outside draws with numbered-ticket export, plus free member and visitor entries. Visitor details remain private to admins. Member winner badges expire with the current season.
- Deploy with no reward offers or raffles active. Their terms and availability are administrator decisions.
- Enroll members in profiles and the Support Board by default while preserving existing saved privacy choices and moderation restrictions. Members can opt out.
- Use approved profile cards across account, recognition, and request attribution. Signed-in members can open a profile to see the actual member name. Keep the previous approved content visible while edits await approval.
- Group admin navigation, show actionable dashboard counts, and open the exact record from Needs attention. Bulk assignment, review, and snoozing do not perform financial, stock, fulfillment, or access actions.
- Combine initial campaign-code issuance with campaign creation. Show Open, Scheduled, Paused, Expired, and Setup incomplete states.
- Make routine notes optional while retaining reasons for accountable financial, inventory, access, moderation, and historical exceptions.
- Create a stable payment reference before opening Cash App. Copy the reference and provide a manual fallback; opening the app never confirms payment.

## Recovery review fixes

The accounting review found that a refund involving written-off debt could otherwise offset a later tab and award unearned points. The recovery patch rejects corrections consuming forgiven debt, including offsets against another tab. A regression checks that the original purchase, later debt, and recognition remain unchanged, while legitimate cancellation of still-unpaid amounts remains supported.

The workflow review also completed date- and configuration-aware campaign status and exact-record navigation for payments, guest orders, profiles, and reports, including records outside the first results page.

## Release constraints

The four new schema files are applied by the existing protected deployment script: earning, redemption, profile experience, and admin experience. They preserve established balances, transactions, inventory, audit history, and earned recognition. The earning start time is recorded on first application; migrations must remain rerunnable without backfilling purchases or resetting that time.

Use the existing D1 database and private R2 bucket. Do not deploy sample fixtures, replace the database, weaken deployment preflight checks, or test purchases/refunds against live member records. Both main and guest Worker build results must be checked for the released commit.

The operational guide is [Murley Bucks and everyday admin workflows](murley-bucks-and-workflows.md). CI covers accounting, authorization, migration preservation, profile privacy, raffle integrity, payment handoff, compiled HTTP routes, and security. Use the pull request's exact-commit results as the durable release evidence.

Round 8, scanning, and additional external integrations remain deferred; recovery does not expand that scope.
