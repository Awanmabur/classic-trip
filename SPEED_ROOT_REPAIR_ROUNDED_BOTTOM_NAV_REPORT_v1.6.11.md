# Classic Trip v1.6.11 — Speed Root Repair and Rounded Bottom Navigation

## Scope

This release starts from the safer v1.6.10 line, which itself was rebuilt from v1.6.7. It focuses on the platform-wide slowdown reported on public marketing pages, listing previews, current-fare/seat availability, payments, and dashboards, while preserving the completed company-route and rolling-departure repairs.

A literal “150% faster” result cannot be guaranteed without timing the user’s live browser and MongoDB Atlas deployment. This repair instead removes the largest source-level causes found in the project and adds regression checks so they do not return.

## Root causes found

1. The public catalog loaded up to 50,000 compatibility seat rows and up to 50,000 future room-night rows before rendering normal cards and marketing pages.
2. Current-fare requests re-read schedule and listing records even when the preview controller had already loaded and verified them.
3. Identical fare/seat requests could run simultaneously while the user changed stops or the browser repeated a request.
4. Dashboard data that could be loaded together was split across sequential database phases.
5. Dashboard snapshots were discarded quickly, so normal navigation repeatedly rebuilt the same data.
6. Local `npm start` development used zero browser caching for CSS, JavaScript, fonts, and images, causing every dashboard navigation to refetch static assets.
7. The rolling materialization worker could continue writing to Atlas frequently while users were opening pages.

## Performance repairs

### Public home, bars, cards, and marketing pages

- Removed global Seat hydration from the catalog snapshot.
- Removed global and initial-listing RoomNightInventory hydration.
- Kept authoritative seat and room-night availability in the selected-date live inventory services.
- Combined independent first-wave catalog reads.
- Increased bounded catalog read concurrency while still respecting MongoDB pool and application read-gate limits.
- Extended listing snapshot freshness to five minutes with a 30-minute stale-while-revalidate window.

This prevents normal cards and marketing pages from becoming slower merely because more seats, departures, or future room nights exist in the database.

### Current fare and seat selection

- Added a 1.5-second in-process availability cache for normal read-only previews.
- Added in-flight deduplication so identical concurrent fare requests share one MongoDB operation.
- Hold-specific reads bypass the cache.
- Seat holds, consumption, and release invalidate the affected departure cache immediately.
- Reused the preview/API controller’s already-verified listing and departure records instead of reading them again.
- Existing transactional seat rechecks remain authoritative, so the speed layer does not weaken booking safety.

### Dashboard pages

- Started independent company dashboard reads in the first query wave rather than waiting for the direct page data to finish.
- Loaded customer/promoter account heads and notifications concurrently.
- Increased dashboard snapshot TTL from 60 seconds to 180 seconds.
- Increased stale dashboard reuse to 30 minutes while background refresh rebuilds data.
- Increased projection cache from five seconds to 60 seconds.

### Browser navigation and static assets

- Development static assets now use a five-minute browser cache with one-minute stale-while-revalidate behavior.
- Production keeps its existing long immutable cache policy.
- Versioned service-worker assets use `classic-trip-static-v1.6.11`, so updates still invalidate cleanly.

### Rolling-worker pressure

- Kept rolling creation at one departure per batch.
- Increased the pause between background batches from two seconds to four seconds so interactive public, payment, and dashboard requests have priority.

## Mobile bottom navigation

- Increased the outer phone bottom-navigation border radius to 34px.
- Increased each navigation item radius to 22px.
- Preserved five equal columns and the full shared page width.
- Added safe-area-aware bottom spacing, inner padding, controlled overflow, and a stronger floating-dock shadow.

## Verification completed

- JavaScript syntax: 584/584
- EJS compilation: 129/129
- Lockfile integrity: 17/17
- v1.6.11 speed/rounded-navigation checks: 15/15
- Safe company-route/preview/navigation checks: 23/23
- Root current-fare/rolling/UI checks: 35/35
- Performance/edit/payment checks: 23/23
- Homepage/payment checks: 47/47
- Dashboard root/seat-map/rolling/capacity checks: 24/24
- Dashboard runtime checks: 15/15
- Final regression checks: 42/42
- Performance architecture check: passed
- Production architecture check: 6842/6842
- Architecture/security check: passed
- Route security check: passed
- Multipart CSRF checks: 40/40
- Browser CSRF checks: 4/4
- Backend end-to-end checks: 20/20

## Environment limitation

`npm ci` could not complete in the repair environment because its internal package mirror returned HTTP 404 for `which-typed-array-1.1.20.tgz`. Therefore a live Atlas/browser timing benchmark and the full dependency-backed `npm run release:check` were not run here. The dependency-free syntax, EJS, architecture, security, regression, and focused performance checks listed above passed.

Run the following in the normal project environment:

```bash
rm -rf node_modules
npm cache verify
npm ci
npm run check:v1611-speed-rounded-nav
npm run release:check
npm start
```

After startup, hard-refresh the browser once or close and reopen the installed PWA so the v1.6.11 asset cache replaces the previous cache.
