# Classic Trip v1.6.8 — Rolling Route Repository, Route Cards and Root Performance Repair

Release date: 6 August 2026

## 1. Confirmed rolling-worker root cause

The worker stack reaches:

```text
companyService.isBusRoute()
  -> companyRepository.routes.findOne(...)
  -> Cannot read properties of undefined (reading 'findOne')
```

`companyService` correctly called `companyRepository.routes.findOne`, but `companyOperationsRepository` did not export `routes` or `routeStops`. The browser request could create the first departure through a different repository path, while the background worker failed as soon as it validated the route for the next date.

### Repair

- Added `routes: new MongoCollection('routes')`.
- Added `routeStops: new MongoCollection('routeStops')`.
- Removed the unused circular repository import.
- Kept rolling writes idempotent and bounded.
- Internal worker failures now retry only three times with backoff, then wait for the five-minute repair scan rather than continuously occupying the MongoDB pool.

No migration or index change is required. Existing rules and dated departures are preserved.

## 2. Every active bus route now has its own home card and bar

A bus listing is expanded into one catalog card per active route instead of always using `listingRoutes(...)[0]`.

Each route card has its own:

- `routeId` and `catalogKey`;
- route label, origin and destination;
- next matching departure;
- route-scoped starting fare;
- listing and booking URL containing the selected `routeId`.

This applies to the homepage, search, routes, company profiles and promoter surfaces. The first four cards remain server-rendered for fast first paint; the compact bootstrap contains all remaining route cards for the existing **More buses** behavior.

## 3. Marketing/home cold path reduced from the root

The previous global marketplace snapshot could load high-cardinality records that cards do not need:

- up to 30,000 exact stop-to-stop segment-fare rows;
- up to 20,000 room-unit rows;
- route stops;
- compatibility seat rows;
- vehicle rows;
- dated room-night rows.

The global marketing snapshot now keeps only card-level data. Exact segment fares, route stops, room units and dated inventory are loaded only after the user opens the relevant listing or selected departure.

Search applies rich filters before compacting the result. It no longer repeats nested fare products, service details, amenities and media structures for every route card.

## 4. Current fare no longer loads a whole listing snapshot

The major current-fare delay was in `GET /api/listings/:listingId/availability`: before calculating a fare, it loaded the listing-scoped catalog containing routes, up to 180 schedules, stops, fare products, segment fares and stay inventory.

For bus requests, the endpoint now:

1. resolves the selected `scheduleId` directly;
2. reuses the departure's immutable route, seat-map and fare snapshots;
3. reads only inventory for the selected journey segments;
4. validates that the authoritative departure belongs to the requested listing;
5. returns the fare and seat state without hydrating the marketplace catalog.

Repeated identical fare calls remain in-flight deduplicated and briefly cached. Browser requests remain debounced and have a bounded timeout, so **Current fare loading** cannot stay indefinitely.

## 5. Payment/checkout hot path

Bus checkout now uses:

- a compact checkout listing snapshot;
- the secure booking draft and active holds;
- only selected outbound and return seat inventory;
- parallel outbound/return availability reads;
- selected departure publication snapshots instead of the global marketplace.

Flash middleware no longer writes an empty flash array to MongoDB on every GET. The CSRF cookie is sent only when its value changes. These changes remove unnecessary Mongo-backed session writes from payment, marketing and dashboard navigation.

## 6. Ticket and return journey behavior

- Standard/VIP ticket date and time, boarding point and drop-off point use one three-column row on desktop and phone.
- Return discovery starts strictly after outbound arrival; legacy departures without `arriveAt` use outbound departure as the fallback floor.
- The browser hides same-time and earlier returns.
- The server repeats the rule against the authoritative schedules during draft creation and resolution, preventing stale or manually changed requests from bypassing it.

## 7. Dashboard Price from and active-page performance

### Price from

Listing and route rows now derive the lowest valid amount from indexed candidates built once per projection:

- fare-product `priceFrom`, `basePrice`, `price` or `amount`;
- stop-to-stop segment fares;
- dated schedule base prices;
- room-type base prices.

### Dashboard speed

- Mongo reads are scoped by the active page.
- Large embedded schedule, booking, payment, taxi and flight fields are excluded where unused.
- Inactive page arrays are removed before enrichment and browser serialization.
- Listing, schedule, user, booking, support and review relations use lookup maps rather than repeated `.find()` scans.
- Live seat maps query only bookings linked to the already-scoped dated departures.
- Dashboard snapshots use TTL/stale caching and page-specific invalidation.

## 8. Runtime timing diagnostics

Every request now records Mongo execution time and admission-gate wait time. Responses expose:

```text
Server-Timing: app;dur=..., mongo;dur=...;desc="N reads", mongo_wait;dur=...
X-Mongo-Reads: N
```

Slow-request logs include:

- total request duration;
- Mongo read count;
- Mongo execution duration;
- Mongo queue-wait duration;
- peak gate queue depth.

This distinguishes an Atlas/network problem from application rendering or connection-pool contention. In Chrome/Edge DevTools, open **Network**, select the request, and inspect **Timing** or the `Server-Timing` response header.

## 9. Verification completed

Passed in the repair environment:

- JavaScript syntax: **585/585**
- EJS syntax: **129/129**
- v1.6.8 route/catalog/dashboard/performance: **36/36**
- v1.6.8 route/rolling/payment/dashboard speed: **30/30**
- Final payment/home release: **47/47**
- Dashboard root performance/live seat maps/rolling: **24/24**
- Current-fare/rolling/UI: **35/35**
- Dashboard runtime: **15/15**
- Performance/edit/payment: **23/23**
- Rolling-worker root audit: **7/7**
- Runtime resilience: **15/15**
- Launch lifecycle: **35/35**
- Dashboard service coverage: **68/68**
- Production bus workflow: **28/28**
- Bus form contracts: **45/45**
- Smart bus forms: **30/30**
- Bus + hotel end-to-end: **57/57**
- Final regression: **42/42**
- Lockfile integrity: **17/17**
- Architecture/security: passed across **66 dashboard sections**

The complete `npm run verify` progressed through the dependency-free checks and stopped when `check:platform-experience` required the unavailable `ejs` package. This repair container has no installed `node_modules`; this is an environment limitation, not a source-check failure. A live Atlas/browser latency measurement was also unavailable here, so the report does not claim a measured production response time.

## 10. Install and run

```bash
rm -rf node_modules
npm cache verify
npm ci
npm run check:v168-route-catalog-dashboard-speed
npm run check:v168-root-speed
npm run release:check
npm start
```

Your previous index reconciliation already reported 1,303 valid indexes across 130 models, and v1.6.8 does not change a model or index. Running `npm run db:indexes` again is optional.

After startup, the rolling log should decrement instead of repeating `undefined.findOne`, for example:

```text
Rolling departure batch completed — created=1 pending=28 skipped=0
Rolling departure batch completed — created=1 pending=27 skipped=0
```

Two MongoDB connection messages are expected under `npm start` because the launcher starts one web process and one background-worker process.
