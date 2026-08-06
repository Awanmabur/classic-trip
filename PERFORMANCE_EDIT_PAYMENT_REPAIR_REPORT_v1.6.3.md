# Classic Trip v1.6.3 Performance, Edit, Payment and Rolling Departure Repair

## Scope reviewed

This release reviews and repairs the partner/admin departure workflow, Live Departure Seat Maps, Departures & Fares, shared dashboard data loading for every role, edit-form hydration, login/dashboard navigation, checkout initiation, and public marketing-page delivery.

## Rolling departures

The earlier success message was misleading in two ways: it held the request open while creating the whole month, and dates saved as Draft were never retried for publication because later materializer runs treated them only as existing records.

The repaired flow now:

- saves the rolling rule and creates one dated departure immediately, so the request returns quickly and proves the rule is valid;
- queues the remaining missing dates for the worker instead of holding the browser open;
- starts the worker automatically with `npm start` in local or single-service deployments;
- keeps Render's dedicated web and worker services separate by setting `RUN_BACKGROUND_WORKER=false` on the Render web service;
- revalidates future Draft dates every 15 minutes and publishes them automatically when readiness becomes complete;
- still adds only the new far-end date as the 30-day window moves, because existing dates are deduplicated;
- reports exact human-readable Draft blockers instead of saying that everything was successfully published.

A Draft is not force-published when the company, listing, route, route segments, vehicle permit/inspection/insurance, seat map, fare plan, currency, time, inventory, or vehicle availability is incomplete. This prevents customers from booking an unsafe or invalid departure. Once the reported blockers are corrected, the worker retries publication automatically.

## Dashboard speed

Dashboard snapshots are now scoped by role and active page instead of loading broad company/platform history on every navigation:

- Live Departure Seat Maps loads only current operational departures and bookings linked to those schedule IDs.
- Departures & Fares loads bounded current schedules, active relationships, recurring rules, fare plans and add-ons.
- Customer and Promoter dashboards load only the entities required by the current page.
- Super Admin and company-role pages use lower page-specific limits.
- Large seat, booking, inventory, notification, user and audit collections are not hydrated unless the active page requires them.
- MongoDB reads remain concurrency-gated so faster page loads do not exhaust the connection pool.
- Departure batch creation resolves route, vehicle, seat map, fare and driver context once, checks a bounded conflict window, creates up to four dates concurrently, and audits inventory once per batch.

## Edit forms

The shared dashboard edit renderer now:

- converts stored ISO values into valid `date`, `time`, and `datetime-local` control values;
- resolves nested dashboard projection shapes instead of assuming every value is at the top level;
- restores assigned drivers and blocked seats;
- restores hotel check-in/check-out times and amenities;
- restores bus pickup/drop-off instructions, baggage rules, cancellation rules, booking policy, contact phone and operating notes;
- keeps existing values visible while a replacement image/file remains optional.

## Payment-page speed

- All external payment-provider calls now use an 8-second bounded timeout and return a controlled `payment_provider_timeout` error rather than hanging indefinitely.
- Pesapal token reuse remains enabled.
- Pesapal IPN registration is cached for 24 hours, removing repeated callback-registration network calls from normal checkout initiation.
- Unrelated dashboard mutations no longer invalidate and rebuild the complete public marketplace catalog.

## Design preservation

No dashboard CSS rule controlling margins, padding, cards, table height, grid spacing, or responsive layout was changed. The stylesheet diff contains only the release-version comment. The new page filters were moved from the oversized `dashboardFilters` wrapper back to the platform's existing compact `tableTools` toolbar.

## Public/marketing performance

- Production static assets use a 30-day immutable cache.
- Home-catalog cache defaults are 5 minutes fresh and 30 minutes stale-while-refresh.
- Cloudinary receives an early browser preconnect.
- Blog and saved-listing images use lazy loading and asynchronous decoding.
- Catalog cache invalidation is limited to mutations that can actually change public inventory/content.

## Validation results

The complete `verify` gate contains 64 command groups:

- **61 passed**.
- **3 could not execute because dependencies are unavailable in this sandbox**, not because a source assertion failed:
  - `check:platform-experience` requires `ejs`;
  - `check:runtime` requires installed runtime modules including `mongoose` and `pdfkit`;
  - `npm test` requires `mongoose`.

Additional focused results:

- JavaScript syntax: **578/578 passed**.
- EJS dependency-free syntax compiler: **129/129 passed**.
- Performance/edit/payment repair audit: **19/19 passed**.
- Dashboard runtime repair audit: **15/15 passed**.
- Launch lifecycle audit: **35/35 passed**.
- Production finalization audit: **29/29 passed**.
- Dashboard workflow relations: **22/22 passed**.
- Dashboard scope, route smoke, marketing mobile overflow, bus forms, hotel operations, security architecture, route security and CSRF checks passed.

`npm ci` was attempted, but the configured sandbox package mirror returned HTTP 404 for the locked `which-typed-array-1.1.20.tgz` tarball. `npm audit` was also blocked because the same mirror does not expose the audit endpoint. No partial `node_modules` directory is included in the release archive.

## Deployment

```bash
npm ci
npm run db:indexes
npm run release:check
npm start
```

For a deployment with a separate worker process:

```bash
RUN_BACKGROUND_WORKER=false npm start
npm run worker
```

The included `render.yaml` already applies this separation correctly. The service-worker cache key and client asset query versions are bumped to `1.6.3`, so browsers do not retain the previous dashboard JavaScript.
