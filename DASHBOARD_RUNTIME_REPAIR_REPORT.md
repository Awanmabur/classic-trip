# Classic Trip Dashboard Runtime Repair Report

Version: 1.6.2  
Repair date: 6 August 2026

## Reported failures

1. Saving a rolling departure displayed a success message, but no dated departures appeared.
2. Live Departure Seat Maps and Departures & Fares could take more than ten minutes to load.
3. Dashboard filters and create/update actions appeared unresponsive.
4. Login appeared to restart the platform without opening the expected dashboard.
5. The same reliability and performance problems affected multiple role dashboards.

## Root causes found

### Shared form submission crash

The central dashboard script used `querySelector()` and then called `.filter()` on the returned single element. This threw a browser exception before submission validation completed, blocking forms across roles.

### False rolling-departure success

The request saved a schedule rule and relied on a later outbox worker. The response claimed the next 30 days were queued without confirming that any dated departure had been created. Validation or readiness errors in the worker were not visible to the partner.

### Unbounded dashboard reads

Several dashboard pages loaded broad company or platform collections, including old bookings, seats, and segment inventories unrelated to the current page. Live seat maps could load full booking and inventory history before rendering.

### Competing login dashboard work

After session creation, login launched a forced dashboard prewarm while the redirected dashboard request also loaded the same data. On large tenants, these reads competed with session persistence and could look like a restart or failed login.

### Stale browser cache

The service worker and dashboard script version could keep the old broken client JavaScript after a deployment.

## Implemented repairs

### Rolling schedules

- Materialize active rules immediately on create, update, and resume.
- Return real created/existing/published/Draft/skipped counts.
- Reject a false success when zero dated departures exist in the active 30-day window.
- Keep the outbox retry for transient database failures.
- Use a distributed per-rule lease across request, outbox, and scheduled worker execution.
- Recheck the full active window on each daily run so missing dates can be repaired.

### Dashboard client behavior

- Collect required controls with `querySelectorAll()` before array filtering.
- Normalize filter text and exact status matching.
- Add search/status/reset filters to departure, rule, fare, add-on, and seat-map tables.
- Preserve the selected live seat map while applying table filters.
- Bump dashboard/static cache version to 1.6.2.

### Dashboard data access

- Page-scope the company and admin snapshots.
- Limit Live Departure Seat Maps to current operational departures.
- Load seat-map bookings only when their schedule IDs match the visible departure set.
- Remove unused segment-inventory and seat-assignment history from schedule and seat-map page loads.
- Bound overview, customer, promoter, support, finance, hotel, flight, and mobility reads.
- Add schedule and booking indexes for the new query paths.

### Authentication

- Persist the regenerated authenticated session before redirecting.
- Remove the duplicate forced dashboard prewarm from login.
- Keep security audit recording off the critical redirect path.

## Validation results

The project contains 71 source-level check programs in the exercised audit set.

- Passed: 69
- Blocked by missing installed runtime package: 2
- Source assertion failures: 0

The passing checks cover JavaScript syntax, EJS source structure, security architecture, protected routes, CSRF, dashboard scope and completeness, all role/service dashboards, bus and stay workflows, flight and taxi workflows, rolling departures, mobile/PWA behavior, UI consistency, and final regression checks.

The blocked checks were:

- `scripts/check-platform-experience-final.js` — requires the installed `ejs` package.
- `scripts/check-runtime-modules.js` — requires the installed `mongoose` package.

`npm ci` could not be completed in this environment because its configured package mirror was missing a locked package tarball. The delivered archive intentionally excludes the incomplete `node_modules` directory.

## Required deployment verification

From a clean checkout with access to the npm registry and the deployment secrets:

```bash
npm ci
npm run release:check
npm run db:indexes
npm start
```

Back up the production database before index reconciliation. Then verify with a real test database and browser:

1. Sign in once for every role and confirm the first dashboard opens without a reload loop.
2. Create an active rolling departure and confirm actual dated departures appear immediately.
3. Confirm one new far-end date is added by the scheduled materialization job.
4. Open Departures & Fares and Live Departure Seat Maps with production-sized data and record response timings.
5. Exercise search, status filters, create, edit, publish, archive, check-in, support, finance, stay, flight, and mobility actions using authorized role accounts.
6. Run the production dependency audit and deployment health checks with the real environment configuration.
