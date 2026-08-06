# Classic Trip v1.6.13 — Desktop Bars, Seat Inventory Repair and Precision Speed Report

Release date: 6 August 2026

## Requested corrections

### Desktop listing bars

- Phone bar sizing was restored to the previously approved 154px layout; the v1.6.12 phone-height increase was removed.
- Desktop bars no longer have a fixed or minimum height. Each bar grows only as much as its actual content requires.
- Company routes wrap normally on desktop with no clipping, hidden overflow, artificial two-row cap or internal route scrollbar.
- Tightened body, route, description and price spacing so natural-height bars do not leave blank vertical gaps.

### Seat-map presentation

- Booked, sold, taken, confirmed, occupied, checked-in and no-show seats render red.
- Orange is reserved for blocked, disabled and maintenance seats.
- The complete seat preview panel, cabin, deck and each physical seat row are centered in the dashboard container.
- `DRIVER - FRONT` has explicit padding, margin, minimum height and centered text.

## Persisted seat-inventory repair

The former destructive instruction to delete and recreate a departure has been replaced with a CSRF-protected **Repair seat inventory** operation.

The repair runs inside a MongoDB transaction and prefers the departure's immutable route and seat-map snapshots. It can:

1. Rebuild missing compatibility seat rows while retaining canonical segment-inventory states.
2. Rebuild canonical seat-by-segment inventory when it is incomplete and the departure has no passenger activity.
3. Recalculate total and available seats and write a new inventory snapshot and audit event.
4. Attempt the same safe repair automatically once when publication fails only because persisted segment inventory is missing.

The operation deliberately refuses automatic rebuilding when it finds reservations, seat assignments, tickets, active holds, or occupied/held states. This prevents repair work from overwriting passenger or payment history.

## Rolling departure conflict repair

Repeated vehicle-overlap failures are now persisted on the recurring rule as a six-hour `vehicle_schedule_conflict` blocker. Blocked rules are excluded from frequent repair scans and the blocker is cleared immediately when the operator edits or resumes the rule.

This removes the repeated warning loop for:

`Selected vehicle is already assigned to an overlapping departure`

while still preserving the conflict for the operator to correct. A recurring rule must use a vehicle whose departure and return-to-service times do not overlap another active departure.

## Request-path performance

- Direct `src/server.js` launches now keep rolling materialization disabled by default. The page-serving process only runs the rolling fallback when `WEB_ROLLING_FALLBACK=true` is explicitly configured.
- The supported `npm start` launcher continues to create separate web and worker processes.
- Persistent rolling conflicts no longer enter five-minute database retry loops.
- Dashboard shell interactions remain immediate; the large workspace loads after first paint, while notifications and PWA support remain idle-loaded.
- Existing v1.6.12 MongoDB query/write/session deadlines, page-scoped dashboard reads, bounded outbox batches, preview prefetch, shared listing snapshots and payment read limits remain intact.

## Verification completed

The dependency-free release matrix passed:

- JavaScript syntax: 591 files
- EJS syntax: 129 templates
- v1.6.13 precision checks: 18/18
- Launch lifecycle: 35/35
- Root performance/current fare/rolling/UI: 35/35
- Final payment/homepage: 47/47
- Final departure/booking UI: 20/20
- Dashboard repository readiness: 8/8
- Performance/edit/payment repair: 23/23
- Production architecture: 6897/6897
- VIP and partner dashboard CRUD: 170/170
- Plus the remaining static security, CSRF, dashboard, bus, stays, payment, route, rolling, PWA and final-regression checks in the 70-command release matrix.

## Environment limitation

A complete dependency-backed runtime run could not be executed in the build environment because its configured npm registry returned HTTP 404 for `which-typed-array@1.1.20`. The release ZIP excludes `node_modules` and temporary install output. Run `npm ci` against a working npm registry, followed by `npm run release:check`, on the deployment machine.

## Performance expectation

This release removes the identified source-level request blockers and repeated worker load. No software package can guarantee an exact percentage improvement on every machine because page speed also depends on Atlas DNS/latency, Redis, hosting CPU/RAM, network quality and production data volume. The architecture now fails fast and protects user requests instead of allowing background work or a single database stall to freeze the whole process.
