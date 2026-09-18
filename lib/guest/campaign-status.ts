import type { Row } from "../pilot/core";

export function campaignStatus(campaign: Row, orderingEnabled: boolean, now = Date.now()) {
  if (campaign.ends_at <= now)
    return { label: "Expired", reason: "The closing time has passed. Edit the campaign dates to reopen it." };
  if (!campaign.code_configured)
    return { label: "Setup incomplete", reason: "Issue a campaign code before sharing access." };
  if (!campaign.configured_options)
    return { label: "Setup incomplete", reason: "Add an active gear option with a price, tax rate, and pickup or shipping enabled." };
  if (!orderingEnabled)
    return { label: "Paused", reason: "Enable guest ordering under Store availability to accept orders." };
  if (!campaign.active)
    return { label: "Paused", reason: "Edit the campaign and enable it to accept orders during its date window." };
  if (campaign.starts_at > now)
    return { label: "Scheduled", reason: campaign.available_options
      ? "Ordering opens at the start time shown below."
      : "Ordering starts at the scheduled time. Restock gear or increase exhausted campaign limits before opening." };
  if (!campaign.available_options)
    return { label: "Paused", reason: "No orderable quantities remain. Restock gear or increase exhausted campaign limits." };
  return { label: "Open", reason: "Shoppers with the current code can place orders." };
}
