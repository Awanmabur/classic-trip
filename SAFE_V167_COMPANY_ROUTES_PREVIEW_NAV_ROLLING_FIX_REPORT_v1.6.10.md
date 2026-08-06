# Classic Trip v1.6.10 — Safe v1.6.7 Company Routes, Preview, Navigation and Rolling Repair

Release date: 6 August 2026

## Baseline and scope

This release was rebuilt directly from the supplied **v1.6.7 rolling-worker repair**, not from the later experimental branches. The approved layout and v1.6.7 worker behavior were retained while the requested route display, booking-preview controls, navigation widths, dashboard fare fallback and remaining repository failure were corrected.

## Root cause of the rolling-worker failure

The worker stack reached `companyService.isBusRoute()`, which calls `companyRepository.routes.findOne(...)`. The company operations repository did not expose a `routes` collection, so the call was effectively `undefined.findOne(...)`. `routeStops` was also absent from the same repository contract and could have failed at the next route-validation stage.

Corrections:

- Added the real `routes` repository to `companyOperationsRepository`.
- Added the real `routeStops` repository to the same contract.
- Retained v1.6.7's bounded rolling retries and single-date materialization path.
- Added a focused contract check proving every route guard now resolves to a defined repository.

No database migration or rule recreation is required. Existing rolling rules can resume after restart.

## Home cards and bars

- Every active bus route attached to the operator listing is now summarized once and exposed on its marketplace item.
- Grid cards and compact Bars cards render the complete route set in a horizontally scrollable route strip.
- The card is not duplicated once per route, avoiding a larger home payload and repeated DOM work.
- Route labels are included in marketplace search text.
- Each route summary carries its next departure, schedule count, available-seat total, route-level starting fare and currency for future UI use.

## Booking preview layout and behavior

Inside the existing journey selector container:

- **Route** and **travel date/time** are opposite each other on the first line.
- **Boarding stop** and **drop-off stop** are opposite each other on the line below.
- The layout remains two columns on phones rather than stacking unpredictably.
- Changing the route immediately filters the departure selector to that route.
- Changing the route clears stale schedule, fare, seat and return-trip state.
- The selected route is preserved in the URL and server-side preview state.
- Return departures are accepted only when their departure time is strictly later than the outbound arrival time, or outbound departure time when arrival is unavailable. The same outbound date/time is therefore not offered as a return.

## Navigation width and phone bottom navigation

- Corrected the homepage selector from `nav.nav` to the actual `header.nav` markup.
- Homepage header, shared-page header, page containers and footer now use one public-shell width variable.
- On phones, the shell uses the available screen width with a small consistent outer gap.
- The bottom navigation is centered against the viewport and uses exactly the same shell width.
- Its five actions use equal columns, stable icon boxes and clipped labels so one item cannot push the others out of alignment.

## Dashboard starting fare

Dashboard listing tables no longer depend only on `listing.priceFrom`. A one-time fare index is built from active fare products and segment fares, then used as an O(1) fallback for each table row. This restores **Price from** without repeatedly scanning the fare arrays for every listing.

## Performance safeguards retained or added

- The global marketplace still returns one operator listing card rather than duplicating it for every route.
- Route summaries are built from data already loaded by the catalog snapshot; no extra per-card MongoDB query was added.
- Listing-scoped snapshots, stale-while-refresh behavior, snapshot fare reuse and bounded MongoDB read concurrency from v1.6.7 remain intact.
- Dashboard fare fallback is pre-indexed once instead of using nested repeated searches.
- The corrected repository contract stops the rolling worker from repeatedly throwing and retrying `undefined.findOne`, removing that avoidable background load from Atlas and the Node.js process.

## Files materially changed

- `src/repositories/domain/companyOperationsRepository.js`
- `src/services/marketplace/catalogService.js`
- `src/controllers/public/listingController.js`
- `src/views/partials/listing-card.ejs`
- `src/views/pages/listing-details.ejs`
- `public/js/home.js`
- `public/css/completion-fixes.css`
- `src/services/dashboard/dashboardProjectionEngine.js`
- `scripts/check-v1610-safe-route-preview-nav.js`
- package, cache and asset-version references advanced to `1.6.10`

## Verification completed in the repair environment

Passed:

- JavaScript syntax: **583/583**
- EJS dependency-free validation: **129/129**
- Rolling-worker root contract audit: **7/7**
- v1.6.10 route/preview/navigation/fare audit: **23/23**
- Lockfile integrity: **17/17**
- Final home/payment source audit: **47/47**
- Authentication/service UI audit: **22/22**
- Performance/edit/payment audit: **23/23**
- Root performance/current-fare/rolling/UI audit: **35/35**
- Dashboard runtime audit: **15/15**
- Dashboard service coverage: **68/68**
- Dashboard/live-seat-map/rolling/capacity audit: **24/24**
- Bus workflow: **28/28**
- Bus forms: **45/45**
- Smart bus forms: **30/30**
- Production architecture: **6842/6842**
- Final regression: **42/42**

A complete dependency-backed `npm run release:check` was not claimed in this repair container because `node_modules` was intentionally absent; checks that directly require installed `ejs` or `mongoose` could not load here. Run the commands below in the normal development environment, where `npm ci` has already succeeded.

## Install and run

```bash
rm -rf node_modules
npm cache verify
npm ci
npm run check:v1610-safe-route-preview-nav
npm run release:check
npm start
```

After startup, the rolling worker should continue the existing rules without the `companyRepository.routes.findOne` failure. Browser/service-worker caches were advanced to v1.6.10, but a hard refresh or reopening the installed PWA once is recommended after replacing the project.
