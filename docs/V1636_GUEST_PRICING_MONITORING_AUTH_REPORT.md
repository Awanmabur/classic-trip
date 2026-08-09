# Classic Trip v1.6.36 — Guest tickets, customer pricing, monitoring and account UX

## Guest tickets
- Bus tickets remain bookable without account login.
- Confirmed bookings automatically queue the secure ticket link and PDF link to both email and WhatsApp.
- The same protected ticket remains available on Classic Trip through the guest access code/session flow.

## UGX bus customer pricing
- UGX 1,000 service fee for the customer ticket fare up to UGX 30,000.
- UGX 2,000 for UGX 30,001–100,000.
- UGX 3,000 for UGX 100,001–150,000.
- UGX 5,000 above UGX 150,000.
- Full published origin→destination bus tickets receive a UGX 3,000 Classic Trip acquisition discount, with a UGX 1,000 minimum customer fare safeguard.
- Intermediate boarding or intermediate drop-off fares receive no full-route discount.
- Partner stored fares are preserved for audit; customer price, discount and service fee are snapshotted separately. Service-fee tiers are evaluated after the full-route discount.
- Commission/payout calculations use the customer fare/add-ons as the commissionable amount; customer service fees are platform charges and are not added to partner commission base.

## Super Admin monitoring
- Added Visitor Monitoring to Super Admin Command Center.
- Captures privacy-safe page views and meaningful actions asynchronously.
- Shows unique visitors, page views, actions, booking/payment signals, top pages, devices, referrers, 4xx/5xx and recent activity.
- No form bodies, passwords, card/payment details, query strings or raw IP addresses are persisted.
- Activity expires automatically after 90 days.

## Account UX
- GET `/register` and `/signup` redirect to the single `/login` account page and signup panel.
- POST `/register` remains the secure registration action.
- Google OAuth buttons remain functional.
- WhatsApp buttons now open real Classic Trip WhatsApp support instead of being inert buttons.
- Tip banner has top spacing.

## Archive
- Restore actions are icon-only with title/ARIA labels for accessibility.
