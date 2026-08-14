# Super Admin Commercial Agreements

Go to **Super Admin → Payments & Commercial Agreements**.

## Rule priority
Platform fallback → Partner → Listing → Bus fare plan / Hotel room type.
The most specific active rule wins.

## Bus examples
- Standard fare plan: Classic Trip earns a fixed amount **per ticket/seat**.
- VIP/Premium fare plan: create a separate fare-plan override with its own fixed amount.
- Percentage agreement: choose **Percentage** and enter the agreed percentage.

## Promoters
Choose None, Fixed amount, or % of Classic Trip share. Promoter rewards apply only when the booking has a valid promoter/referral attribution.

## Customer discounts
Choose None, Fixed amount, or % of Classic Trip share. The discount is deducted from Classic Trip's share; the partner's contracted payout is not reduced again.

## Hotels
Use partner/listing terms for the whole property or a Room Type override. Fixed agreements can use **per room** or **per room-night**.

## Settlement rule
Every booking freezes its resolved agreement/version and computed split. Settlement uses that frozen split, so editing an agreement later does not rewrite historical bookings.
