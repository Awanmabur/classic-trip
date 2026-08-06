# Classic Trip v1.6.9 — Company Route Cards, Preview Layout, Navigation and Dashboard Recovery

## Request implemented

This repair keeps the approved design structure and changes only the affected marketplace, preview, navigation and dashboard paths.

### One bus card/bar per operator listing

The previous v1.6.8 catalog expanded one bus listing into one card per route. That is why the same company appeared repeatedly and each card showed only one route.

The catalog now:

- builds one bus marketplace item per operator listing;
- embeds every active route as a compact route summary;
- calculates the card's lowest starting fare across its routes;
- combines route availability without duplicating the whole card;
- opens the preview without forcing the first route;
- keeps origin/destination search aware of every embedded route.

Both server-rendered and JavaScript-rendered cards display all routes in a compact horizontal route strip. The strip remains scrollable on small screens so all routes stay available without increasing card height excessively.

### Preview route and journey selection

The bus preview now has a four-control journey container:

1. Route and travel date/time on the first line.
2. Boarding and drop-off on the second line.

The route selector controls the rest of the flow. Changing route:

- filters Standard and VIP departure counts to that route;
- filters the travel time selector to that route;
- clears the previous route's schedule, stops, seats, fare and return selection;
- keeps boarding/drop-off disabled until a real departure is selected;
- updates `routeId` in the browser URL without reloading the page.

The existing return safeguard remains: a return departure must be strictly later than the outbound arrival/departure floor.

### Top and bottom navigation

The homepage markup uses `<header class="nav">`, but the earlier shell-width patch targeted `body.homePage > nav.nav`. The rule therefore never reached the homepage header.

The corrected rule targets the real header and gives header, content and footer the same width. On phones the shell uses 6 px side margins.

The phone bottom navigation also had conflicting rules: the fixed component was centered with `left:50%` and `translateX(-50%)`, then a later override changed it to `left:auto`. The final override restores deterministic centering and uses five equal columns with overflow-safe buttons and labels.

### Dashboard recovery

The v1.6.8 dashboard projection applied page pruning before `enrichCompanyDashboard`. That could remove arrays and option lists that enrichment or the client still needed, which could make a dashboard page fail even though its database query completed.

The snapshot layer also applied broad negative field projections to schedules, bookings and payments. Those projections could return incomplete records to shared formatters.

v1.6.9 removes those two risky layers while preserving the real performance controls:

- active-page entity selection;
- bounded result limits;
- schedule/date scoping;
- tenant/page cache keys;
- indexed relationship maps in the projection engine.

The Listings page retains `fareProducts` and `busSegmentFares` so `Price from` can be calculated, but it no longer loads schedules merely to render the listing table.

## Files changed

- `src/services/marketplace/catalogService.js`
- `src/controllers/public/listingController.js`
- `src/views/pages/listing-details.ejs`
- `src/views/partials/listing-card.ejs`
- `public/js/home.js`
- `public/css/completion-fixes.css`
- `src/services/dashboard/dashboardProjectionEngine.js`
- `src/services/dashboard/dashboardSnapshotService.js`
- browser asset versions, service-worker cache and static regression scripts

## Verification completed

Passed in the repair environment:

- JavaScript syntax: **586/586**
- EJS dependency-free validation: **129/129**
- v1.6.9 focused company-route/preview/navigation/dashboard audit: **32/32**
- route/catalog/dashboard/performance audit: **36/36**
- route/rolling/payment/dashboard audit: **30/30**
- current-fare/rolling/UI audit: **35/35**
- performance/edit/payment audit: **23/23**
- final payment/homepage audit: **47/47**
- dashboard root performance/seat-map/rolling audit: **24/24**
- dashboard runtime audit: **15/15**
- dashboard service coverage: **68/68**
- dashboard workflow relationships: **22/22**
- dashboard repository readiness: **8/8**
- dashboard route/scope validations passed
- final UI consistency: **16/16**
- add-on/return/seat audit: **30/30**
- stop-pricing/UI audit: **15/15**
- bus workflow: **28/28**
- bus form contracts: **45/45**
- smart bus forms: **30/30**
- final regression: **42/42**
- lockfile integrity: **17/17**

`npm run verify` passed through production readiness, platform layout and dashboard service coverage, then stopped at `check:platform-experience` because this container could not install `ejs`. `npm ci` was attempted, but the configured internal package mirror returned HTTP 404 for `which-typed-array-1.1.20.tgz`. The dependency-free EJS compiler still validated all 129 templates.

A live Atlas/browser response-time benchmark was not available in this repair environment, so no fabricated millisecond speed claim is made. The duplicated bus-card payload and the dashboard's destructive post-projection path were removed at source.

## Run locally

```bash
rm -rf node_modules
npm cache verify
npm ci
npm run check:v169-company-routes-preview-nav-dashboard
npm run release:check
npm start
```

No database index reconciliation is required because v1.6.9 changes no model or index.
