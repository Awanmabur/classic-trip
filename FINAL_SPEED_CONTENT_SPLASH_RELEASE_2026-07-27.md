# Classic Trip 1.4.0 — Final Speed, Content, Mobile and Splash Release

Release date: 27 July 2026

## Completed changes

### Compact fare copy

The long subtitle below bus prices was replaced with **Fare by stops**. It is constrained to one line with safe ellipsis behaviour on narrow cards.

### Three-line public descriptions

Marketplace-card descriptions now occupy a consistent three-line preview. Longer descriptions are truncated visually without changing the complete database content.

The sentence supplied for sizing contains exactly:

- **125 characters**, including spaces and punctuation
- **20 words**

Partners are therefore told to enter a minimum of **125 characters (about 20 words)**. The rule is enforced in the dashboard form and again in the backend for bus, stay/Airbnb, tour, car-rental, cargo and other marketplace listings. A live character counter appears in create and edit forms.

### Reused operating-location information

For bus services, the partner selects an existing operating terminal once. Its saved city, country and address are reused automatically instead of being typed again.

### Faster date, time and stop selection

The bus availability path was reduced and protected as follows:

- Route, listing, stops, route segments, seat map, fare product and stop fares load in parallel.
- Read-only availability requests no longer perform a platform-wide stale-hold cleanup before responding.
- Expired held rows are presented as available immediately.
- Checkout still expires stale holds, rechecks all selected seat segments and acquires the final transactional lock.
- The browser cancels stale requests when the customer changes the schedule or stops quickly.
- Request sequence checks prevent slower old responses from replacing the newest choice.
- Availability uses a five-second cache and return schedules use a thirty-second cache.
- Return schedules are not requested until Return trip is enabled.
- Selectors show a clear loading state while the canonical server fare and seats update.

### General public-page speed

- Listing images use lazy loading and asynchronous decoding.
- Production static assets use a seven-day cache with versioned URLs/service-worker cache updates.
- The Font Awesome CDN connection is preconnected.
- Existing marketplace and dashboard cache/read optimisations remain active.

### Mobile Profile drawer

Marketplace categories are restored after the main navigation links when the mobile Profile drawer opens. The drawer includes buses, stays, Airbnb homes, flights, local taxi, tours, car rentals, cargo and availability shortcuts.

### Phone dashboard statistics

Dashboard statistic groups are explicitly constrained to two cards per row on phone widths, including overview, finance, seat, manifest, hotel-operation and mobility metrics.

### Single installed-app launch surface

There is still no second HTML/JavaScript splash. The PWA manifest now uses transparent 192px and 512px branded lockups containing:

- Transparent Classic Trip logo
- Classic Trip name
- “Move, stay and fly with confidence.”

The service-worker cache was moved to `classic-trip-static-v1.4.0` so installed devices receive the new launch assets. Android, iOS and the installed browser ultimately control native splash scaling and cropping.

## Verification completed

- JavaScript syntax: **532/532**
- EJS templates: **127/127**
- Final speed/content/drawer/splash contract: **20/20**
- Single native splash: **7/7**
- Mobile navigation/PWA: **18/18**
- PWA installation: **42/42**
- Orientation lock: **8/8**
- Mobile buttons/statistics: **10/10**
- Marketing mobile overflow: **27/27**
- Departure/booking UI: **20/20**
- Stop pricing UI: **15/15**
- Dashboard completeness: **52/52**
- VIP and Partner Admin CRUD: **170/170**
- Seven-service completion: **38/38**
- Production finalization: **30/30**
- Production readiness: **76/76**
- Reference UI preservation: **178/178**
- System completion: **158/158**
- Final regression: **42/42**
- Flight/taxi workflows: **110/110**
- Bus workflow: **28/28**
- Bus forms: **45/45**
- Smart bus forms: **30/30**

`npm ci` was attempted in the build environment, but its internal npm gateway returned repeated HTTP 503 responses. The partial `node_modules` directory was removed. Jest could not run because the dependency installation did not complete; run the dependency-backed checks locally after `npm ci` succeeds.

## Development setup

```bash
cd classic-trip-final-speed-content-splash-2026-07-27
cp .env.example .env
npm ci
npm run seed:superadmin
npm run db:indexes
npm run check
npm run check:final-polish
npm test
npm run dev
```

## Existing database upgrade/start

No destructive data migration is required for this release. Existing listings shorter than 125 characters remain readable, but must be expanded before their next publish/update readiness check.

```bash
cd classic-trip-final-speed-content-splash-2026-07-27
cp .env.example .env
npm ci
npm run db:indexes
npm run doctor
npm run verify
npm run dev
```

## Production startup

Configure production MongoDB, sessions, payments, media, messaging, map/routing and flight-supplier credentials first.

```bash
cd classic-trip-final-speed-content-splash-2026-07-27
npm ci --omit=dev
npm run db:indexes
npm run doctor
NODE_ENV=production npm run launch:check
npm run start:prod
```
