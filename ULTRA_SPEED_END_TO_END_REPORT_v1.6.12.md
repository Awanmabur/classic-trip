# Classic Trip v1.6.12 — Ultra-Speed End-to-End Repair

Release date: 6 August 2026

## Why the platform appeared frozen

The supplied runtime trace shows that `processOutbox` remained active for **755,759 ms** after MongoDB Atlas DNS resolution failed. During that interval, Node Cron reported many missed executions and the rolling, taxi-dispatch and repair jobs queued behind the stalled database operation. Because the web and job work shared one Node process in that run, login, listing preview, payment and dashboard requests all appeared slow even when their own UI code was small.

This release removes that multi-minute blocking class. It does not promise a literal 1000% speed increase on every connection; actual latency still depends on Atlas region/DNS, hosting, Redis, media delivery and user network quality. The implementation instead applies hard bounds and reduces the amount of work on every critical path.

## Database and worker fail-fast protection

- Mongo wait-queue timeout: 2.5 seconds.
- Mongo server selection timeout: 4 seconds.
- Mongo connection timeout: 5 seconds.
- Mongo socket timeout: 15 seconds.
- Per-query maximum execution time: 5 seconds.
- Global heavy-read admission queue timeout: 1.2 seconds.
- Read queries and outbox/lease update operations now use bounded `maxTimeMS`.
- Scheduled jobs skip immediately while Mongoose is disconnected.
- Every scheduled job has a 45-second outer deadline.
- Outbox batches are limited to 8 events and run every 30 seconds in the Render worker blueprint.
- The web blueprint keeps jobs and the rolling queue disabled; the dedicated worker owns them.
- The Render deployment settings now match the code defaults instead of overriding them with 30–90 second waits.

## Login and public first-paint speed

- Signed-out login, signup, listing-preview and checkout-preparation forms use a signed double-submit CSRF token without writing an empty server session.
- The production Mongo session-store fallback uses the same short fail-fast timeouts.
- Google Fonts were removed from the render-critical path; system fonts paint immediately.
- Font Awesome CSS is attached after first paint/idle instead of blocking HTML rendering.
- Notifications and PWA code load after the important homepage/login content.
- Marketing HTML, homepage models and listing snapshots use bounded stale-while-revalidate caches.

## Listing preview and payment speed

- Card/bar links are prefetched on hover, focus, touch and near-viewport visibility.
- Listing detail pages use safe private browser caching so a per-browser CSRF cookie is never stored in a shared CDN cache.
- Listing snapshots are shared through Redis when available and may serve a valid stale model through a temporary Atlas interruption.
- Cold listing reads are bounded to 80 routes, 80 add-ons, 90 nearest departures, 400 route stops, 160 fare products and 1,200 detailed segment fares only when publication snapshots do not already cover the route.
- Stay preview reads are bounded to the useful room/unit/night range.
- Payment preparation reuses the listing snapshot and immutable route, fare and seat-map publication snapshots.
- Live fare requests remain deduplicated and timeout-bounded; return discovery does not block outbound availability.

## Dashboard speed for every role

- The server renders only the requested dashboard section.
- Each role/page loads only its required Mongo entities and now uses lower record caps.
- Large secret/provider payload fields are excluded from dashboard reads.
- Browser bootstrap JSON contains only active-page arrays and bounded option collections.
- Table row factories run only when their target table exists and is visible.
- A tiny `dashboard-shell.js` handles menu, theme and sidebar search immediately.
- The 416 KB all-feature CRUD workspace loads after first paint/idle instead of competing with HTML, CSS and initial layout.
- Dashboard snapshots can serve stale data for 30 minutes during a short Atlas/DNS outage while refresh is attempted in the background.
- Heavy dashboard/catalog reads share a bounded process-wide admission gate, reserving pool capacity for authentication, sessions and writes.

## Requested UI repairs

- Desktop listing bars are 198 px high.
- Phone listing bars are 190 px high.
- Company routes wrap into up to two visible rows, with a small internal scroll only when there are more routes than fit.
- `DRIVER - FRONT` has additional padding, margin and minimum height.
- The visual seat map and bus cabin are centered in the dashboard.
- The rounded phone bottom navigation from v1.6.11 remains intact.

## Verification completed in this environment

- JavaScript syntax: 590/590.
- EJS syntax: 129/129.
- v1.6.12 focused ultra-speed checks: 16/16.
- v1.6.11 performance baseline: 13/13.
- CSRF: 44/44 combined multipart/browser checks.
- Dashboard runtime repair: 15/15.
- Performance/edit/payment repair: 23/23.
- Root performance/current-fare/rolling/UI: 35/35.
- Safe route/preview/navigation: 23/23.
- Final payment/homepage: 47/47.
- Final regression: 42/42.
- The broad `npm run verify` passed every dependency-free gate through dashboard service coverage, then stopped because `node_modules` is not included and the environment could not resolve the `ejs` module. A clean `npm ci` must be run on the deployment machine before the complete runtime/unit-test tail.

## Deployment requirement

Use the supplied `render.yaml` with separate web, worker and Redis services. Do not copy old environment values that set Mongo selection/wait/socket timeouts to 30–90 seconds. Run:

```bash
rm -rf node_modules
npm cache verify
npm ci
npm run release:check
npm start
```
