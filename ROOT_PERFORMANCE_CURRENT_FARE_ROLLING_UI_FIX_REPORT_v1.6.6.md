# Classic Trip v1.6.6 Root Performance, Current Fare, Rolling Worker and UI Repair

Release date: 6 August 2026

## What was actually causing the slowdown

The 1.6.5 launcher started both the web server and background worker, but the web process could still accept local rolling-materialization queue jobs after the save request. That meant the same web process serving dashboards, current-fare requests and payment navigation also continued creating the remaining 29 dated departures and repeatedly invalidating dashboard caches.

The cache-invalidating debounce was also shorter than the rolling batch pause, so the dashboard cache could become cold between batches. Pages with zero data looked fast because there was little to project or serialize; pages with one or more records paid the database, projection and render cost while rolling writes were competing for the same MongoDB deployment.

## Rolling departure repair

- The normal `npm start` launcher assigns the in-memory rolling queue only to the worker.
- The web process creates one dated departure during the save action, then returns and redirects.
- Remaining dates are created by the worker one at a time, with a two-second yield between dates and a ten-second startup delay after deployment/request bursts.
- The worker and all request/outbox materializers continue to use the distributed per-rule lease and unique schedule protection.
- Production web processes default to `WEB_ROLLING_FALLBACK=false`. A standalone production web service must explicitly set `WEB_ROLLING_FALLBACK=true` only when no separate worker exists.
- Render's web service now explicitly disables the fallback, while its worker owns rolling and scheduled jobs.
- Dashboard cache invalidation is debounced for five seconds, longer than the batch pause, so affected pages are invalidated once after the rolling drain settles.
- A repeated permit, insurance, inspection or similar publication blocker is remembered for five minutes. The worker may create missing Draft dates without rerunning the same failed publication validation for every date.
- Permanent validation failures pause until the repair scan instead of entering a hot loop.
- The release assertion that still expected the previous queue implementation was corrected.
- Flash text is long enough to show the complete vehicle-operating-permit blocker rather than ending at `operat...`.

### Expected message after this repair

Saving an active rule can still report one immediately available date and 29 remaining dates. The important difference is that the web request does not create those 29 dates. The background worker owns that work and yields between each date.

A missing or expired operating permit remains a valid publication blocker. The created records stay Draft until the vehicle has a valid, unexpired permit. The system does not bypass this safety requirement.

## Current fare and boarding/drop-off repair

- Availability now reconstructs route, stop, segment, seat-map and fare context from the immutable snapshots stored on the selected departure.
- Full route journeys avoid a detailed segment-fare collection read when the published snapshot already contains the required price.
- Intermediate stop pairs use compact snapshot fare rows when present and query only when an older departure lacks them.
- Segment inventory queries are limited to the selected journey segments and, where supplied, the selected seat numbers.
- Identical in-flight availability requests are deduplicated.
- Rapid boarding/drop-off changes are debounced by 180 ms instead of launching overlapping requests.
- A stale request is aborted when a newer journey selection is made.
- The browser request has an eight-second timeout, so Current fare cannot spin forever.
- The preview fare remains visible while live availability is being confirmed.
- Return departures load after the outbound availability result and no longer block it.
- The selected schedule cache lasts five seconds, bridging the hold-to-payment redirect without a second cold departure read.

## Payment-page repair

- Listing, booking and payment lookups use a listing-scoped catalogue snapshot instead of loading the complete public marketplace.
- Listing-scoped bus snapshots query only that listing's routes, published departures and add-ons.
- They reuse route and compact fare snapshots already stored on the departures.
- They no longer load every compatibility `Seat` row for every dated departure in the 30-day rolling window.
- Hold and checkout inventory queries remain limited to the selected schedule, seats and journey segments.
- HTTP and Pesapal provider calls use bounded six-second timeouts.

## Dashboard root repair

- Dashboard snapshots remain keyed by role, tenant and active page.
- Only the arrays required by the active page are serialized to the browser.
- Live Departure Seat Maps reads only relevant schedules and bookings tied to those schedule IDs.
- Successful writes invalidate only affected dashboard pages instead of flushing all roles and pages.
- Repository reads accept field projections to avoid hydrating unused document fields.
- The shared workspace source was reduced from 64,464 bytes to 58,315 bytes without changing its rendered contract, restoring the architecture size gate.
- The web process no longer competes with rolling departure writes under normal local startup or separate-worker production deployment.

## Public UI repair

- Bar cards use a 190 px image column on desktop and 142 px on phones.
- The service badge is at the image bottom-left.
- The rating/New badge is at the image bottom-right.
- Phone descriptions remain visible in one small ellipsized line.
- Header, content body, footer and mobile bottom navigation use the same shared outer width.
- Existing Seat Selection/Room Selection and layout-switch controls remain grouped on phones.

## Important deployment variables

### Local or single-service startup

```bash
npm start
```

The launcher starts the web server and worker. The web process has `WEB_ROLLING_FALLBACK=false`; the worker owns the queue.

### Separate web and worker services

Web:

```bash
NODE_ENV=production RUN_BACKGROUND_WORKER=false WEB_ROLLING_FALLBACK=false ENABLE_JOBS=false npm start
```

Worker:

```bash
NODE_ENV=production ENABLE_JOBS=true npm run worker
```

### Standalone production web with no worker

Use only when there truly is no worker service:

```bash
NODE_ENV=production RUN_BACKGROUND_WORKER=false WEB_ROLLING_FALLBACK=true npm start
```

## Verification completed

- JavaScript syntax: 580/580.
- EJS syntax: 129/129 using the dependency-free compiler.
- Final release cleanup: 23/23.
- Lockfile integrity: 17/17, 256 package entries.
- Final payment and homepage release: 47/47.
- Root performance/current-fare/rolling/UI audit: 35/35.
- Dashboard root performance, live seat maps, rolling and capacity: 24/24.
- Dashboard runtime repair: 15/15.
- Performance/edit/payment repair: 23/23.
- Deep cleanup: 26/26.
- Launch lifecycle: 35/35.
- Production finalization: 29/29.
- Architecture/security: passed with 66 dashboard sections and a 58,315-byte workspace.
- Production architecture: 6842/6842.
- VIP/dashboard CRUD: 170/170.
- Flight/taxi static end-to-end: 110/110.
- Bus workflow: 28/28.
- Bus form contracts: 45/45.
- Smart bus forms: 30/30.
- Dashboard service coverage: 68/68.
- Final regression: 42/42.
- In the verification commands after the dependency-bound platform-experience gate, 37 commands passed. The only two failures were runtime loading and unit tests because `mongoose` was not installed.

## Environment limitation during this repair

The repair container did not have `node_modules`. Its configured package mirror did not provide the locked package tarball during installation, so checks that directly require installed `ejs` or `mongoose` could not run here. This is not presented as a passed runtime test.

The user's machine already demonstrated that `npm ci`, the Atlas connection and index reconciliation work. Run the complete release gate there:

```bash
npm ci
npm run db:indexes
npm run release:check
npm start
```

Then smoke-test a bus with a valid operating permit, change boarding/drop-off stops, proceed through hold and payment, and open data-bearing dashboard pages while the worker completes a rolling month.
