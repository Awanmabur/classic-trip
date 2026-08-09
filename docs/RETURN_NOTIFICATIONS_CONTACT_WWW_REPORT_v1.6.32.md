# Classic Trip v1.6.32 — Return Tickets, Notifications, Contact Hub and WWW Domain

## Return ticket repair
- Reverse availability is discovered from real live future departures for the same company and the reversed selected journey.
- Return departure time does not need to equal the outbound time or estimated arrival time.
- Reverse route-stop IDs may differ because route-stop records are route-specific; branch identity and normalized terminal/location names are accepted.
- The reverse service may use Standard or VIP independently of the outbound class; the UI labels each returned departure with its actual class.
- Return selection still enforces sensible chronology: the return must be future and cannot depart before the selected outbound departure begins.
- Initial hold validation, recovered hold validation, and final booking validation use the same flexible reverse-journey logic.
- Outbound and return legs must remain with the same bus company and the same passenger count.

## Notification and push repair
- Added persisted `readAt` state to notifications.
- Added mark-one-read and mark-all-read functionality.
- Admin campaigns always create an in-app record and can also send push/email/SMS/WhatsApp as configured.
- Notification center can load even if Web Push/Service Worker support is unavailable.
- Browser push subscriptions are re-saved after login/redeploy so the active endpoint stays associated with the current user.
- Added server-side active subscription reporting and a real Test push action.
- Added `npm run push:generate-keys` for local VAPID key generation.

## Global support/contact hub
- Uses +256781977217 for Classic Trip WhatsApp/contact and direct calling.
- Includes the supplied WhatsApp group link.
- One floating Contact button opens the three actions vertically.
- Included on public pages, authentication/invitation pages, dashboards, and standalone operational pages; hidden when printing.

## Canonical domain
- Production origin is `https://www.classictrip.org`.
- Exact requests to `classictrip.org` redirect with HTTP 308 to the same path on `www.classictrip.org`.
- Render, SEO URLs, payment callbacks, and deployment guidance use the canonical `www` origin.

## Production push requirement
Web Push cannot work until production has a valid VAPID public/private key pair. Generate it locally with `npm run push:generate-keys`, copy the public/private values to Render, keep the private key secret, and use `mailto:support@classictrip.org` as the subject.

## Verification environment note
The dependency-free release gates passed in the build environment. A clean `npm ci` attempt could not complete here because the environment's internal npm mirror returns HTTP 404 for `which-typed-array@1.1.20`; any partial `node_modules` directory was removed. Run `npm ci` and `npm run release:check` on the deployment/local machine using its normal npm registry before going live.
