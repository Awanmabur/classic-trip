# Classic Trip final launch audit — 30 July 2026

## Outcome

The source-level, render-level and unit launch gates pass. The release repairs
the recurring-departure publication fault, adds a relationship-safe 30-day
archive lifecycle, removes wasted phone width around the public bus seat map,
and reduces MongoDB pool contention between web requests and background jobs.

This audit does not replace a provider sandbox test, a production load test,
backup restoration drill or independent penetration test.

## Recurring departures

- An active rule maintains a rolling 30-day calendar window: today plus the
  following 29 days.
- Creating or resuming a rule queues materialization in the worker instead of
  generating a month during the dashboard request.
- Ready dates request Published status and become public/bookable.
- Incomplete dates remain Draft and retain their readiness failures.
- Legacy rule-generated `active` departures are reconciled to Published or
  Draft, repairing the public “Coming soon” state.
- The worker performs one guarded reconciliation immediately at startup, so
  existing departures do not wait for the next scheduled cron after deployment.
- One new far-end day is created by the daily materializer as the oldest day
  passes.
- Month creation resolves shared route, vehicle, seat map, fare and driver
  relationships once and creates at most two dates concurrently.

## Archive lifecycle

- Archive actions disappear from active dashboards and marketplace queries
  immediately.
- Archive-capable models receive `archivedAt`, `archivedBy` and `purgeAfter`.
- The expiry is 30 days.
- A daily worker job deletes only expired, unreferenced records in bounded,
  sequential batches.
- Records referenced by bookings, reservations, tickets or other protected
  history remain hidden under a retention hold instead of corrupting history.
- Runtime casting verified every configured dependency query remains scoped;
  no cleanup dependency filter collapses to an empty MongoDB query.

## Performance and 503 controls

- Web and worker processes use separate MongoDB connection budgets.
- MongoDB connection establishment is bounded.
- Dashboard read concurrency is capped below the web pool ceiling.
- Redis remains required by the production blueprint for sessions, rate
  limits and short-lived caches.
- Outbox work drains in short batches.
- A scheduled job cannot start a second copy while its previous run is active.
- Known informational bus events are acknowledged once instead of being
  retried eight times without a subscriber.
- Recurring month generation runs outside the web request path.

These changes remove identified sources of pool starvation. A remaining 503 in
production should be correlated by `X-Request-ID` with slow-request logs and
MongoDB Atlas metrics; it must not be treated as proof that user data was lost.

## Page, feature and security verification

- JavaScript syntax: 541/541 files.
- EJS compilation: 127/127 templates.
- Runtime module loading: 26 critical modules.
- Reference UI contract: 178/178 assertions.
- Production architecture: 6,697/6,697 assertions.
- Dashboard service coverage: 68/68 assertions.
- Partner/dashboard CRUD workflow: 170/170 assertions.
- Flight and taxi flow: 110/110 assertions.
- Production readiness: 76/76 assertions.
- New rolling/archive/performance lifecycle: 28/28 assertions.
- Jest: 14/14 suites and 60/60 tests.
- Production dependency audit: zero reported vulnerabilities.

The verification also covers all dashboard section templates, role and tenant
scope, route authentication/authorization, CSRF for normal and multipart
forms, responsive table containment, selector/entity relationships, bus and
hotel workflows, stop-dependent fares, seat layout rules, driver selection,
payments/webhooks, commission ownership and public marketplace visibility.

## Required production checks

Before accepting real payments:

1. Deploy both the web service and worker from `render.yaml`, with the managed
   Key Value service connected.
2. Run `npm run db:indexes`.
3. Run `npm run doctor` against the production environment.
4. Confirm only the worker has `ENABLE_JOBS=true`.
5. Confirm Atlas supports transactions and review connection/slow-query
   metrics during a 30-day recurring-rule creation.
6. Test signup, login, one complete bus booking, payment callback, ticket,
   cancellation/refund and archive expiry in the provider sandboxes.
7. Restore the latest database backup into an isolated environment.
8. Complete an independent penetration test and a realistic concurrent load
   test before public launch.
