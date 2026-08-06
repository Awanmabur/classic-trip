# Classic Trip v1.6.14 — Vision-Style Bars, Red Taken Seats, Route Labels and Rolling Speed

Release date: 6 August 2026

## 1. Desktop listing bars

- The correction is scoped to desktop widths only (`min-width: 681px`).
- The phone bar layout and dimensions remain unchanged.
- Desktop bars use natural content height; no fixed or minimum card height forces blank space.
- The image column is fixed at 190 px wide and the image is fixed at 150 px high, matching the compact Vision Coaches proportion.
- The image stays aligned to the top and cannot stretch when company routes wrap onto more lines.
- Route chips wrap naturally and increase only the text side of the bar.
- Internal body, metadata, description, price and action gaps are compacted so the bar does not leave unnecessary vertical space.

## 2. `DRIVER - FRONT` spacing and seat-map centering

- The driver/front area now has explicit padding, a dashed lower divider and an 18 px gap before the first physical seat row.
- The driver pod has its own horizontal padding and minimum height.
- Desktop physical rows use equal-width left and right tracks around a fixed centre aisle.
- One-, two-, three- and four-seat side groups receive matching widths, keeping the aisle and the complete cabin centered even on asymmetric 2×3 or 3×2 templates.
- The public preview front marker also has a separate bottom gap before seats.

## 3. Taken-seat colour is authoritative

The earlier orange result could occur when booking evidence existed but the raw seat status still produced a blocked-style class. v1.6.14 resolves the final visual state before rendering:

- A booking reference, ticket number, or a state of `booked`, `taken`, `sold`, `confirmed`, `occupied`, `checked_in` or `no_show` produces `data-seat-state="taken"`.
- Taken seats receive an inline critical red fallback plus the final high-specificity red CSS layer.
- Taken seats use `#dc2626` with a `#b91c1c` border.
- Held/reserved seats remain green.
- Only blocked, disabled, unavailable and maintenance seats remain orange.
- The same authoritative state logic is used on the public preview and dashboard visual seat map.

## 4. Platform-wide route presentation

A shared `formatRouteLabel()` helper now presents origin/destination journeys as:

`Origin ⇄ Destination`

It normalizes existing `to`, `→`, `->`, `↔` and `⇄` separators. It is used by:

- Homepage cards and bars
- Listing preview, booking form, confirmation and tickets
- Company profiles and public route pages
- Dashboard route, schedule, saved-trip, manifest, flight and mobility views
- Dashboard JavaScript option labels
- Marketplace, company, archive and customer projections
- Driver ticket and manifest views
- Bus, rental and cargo PDFs
- Archived stop-to-stop fare records

Date ranges and status-transition sentences are intentionally not treated as route labels.

## 5. Rolling materializer timeout and repeated blocker repair

The repeated blocker timestamps occurred because conflict fields were written by the worker but were missing from the strict `ScheduleRule` schema. They could therefore be discarded, making the same overlap appear new during the next scan.

v1.6.14 adds the canonical persisted fields:

- `materializationBlockedAt`
- `materializationBlockedUntil`
- `materializationBlockerCode`
- `materializationBlockerReason`
- `materializationBlockerFailures`
- `materializationStateUpdatedAt`

Additional protections:

- The worker re-reads the rule before writing a blocker.
- An active blocker is never extended by another scan or queue pass.
- A conditional write prevents concurrent workers from replacing the winning blocker.
- The blocker is cleared when it expires or the rule is edited/resumed.
- The scheduled `materializeSchedules` callback queues eligible rules and returns quickly when the dedicated queue owner is active.
- Slow date creation happens in low-priority background batches rather than inside the 45-second cron callback.
- CLI/test synchronous execution is bounded to a 25-second work budget.
- The worker takes ownership of the rolling queue before scheduled jobs are registered.

## 6. Speed architecture preserved

This release keeps the earlier end-to-end performance work:

- Dedicated web and worker processes
- Fail-fast MongoDB connection, query and write deadlines
- Page-scoped dashboard reads and record limits
- A small immediate dashboard shell with the large CRUD workspace deferred until after first paint
- Anonymous-page session avoidance
- Preview prefetch and bounded preview/payment reads
- Redis/shared listing snapshots and stale dashboard fallbacks
- Bounded outbox batches and low-priority rolling work

No application can guarantee an exact percentage improvement because Atlas DNS/latency, hosting CPU/RAM, Redis availability, network speed and production data volume remain external factors. The application-level repeated blocker, fixed-bar, seat-state and synchronous materializer bottlenecks identified in this release are removed.

## 7. Verification

Dependency-free verification completed successfully:

- JavaScript syntax: **593/593**
- EJS syntax: **129/129**
- v1.6.14 precision checks: **14/14**
- Dashboard service coverage: **68/68**
- v1.6.13 precision/inventory invariants: **18/18**
- v1.6.12 ultra-speed invariants: **16/16**
- v1.6.11 speed checks: **13/13**
- v1.6.10 route/preview/navigation checks: **23/23**
- Full dependency-free verification matrix: **72 command groups passed, 0 failed**

Three runtime groups were not executed in the clean release tree because `node_modules` is intentionally excluded: one requires `ejs` and two require `mongoose`. Run `npm ci` followed by `npm run release:check` in the deployment environment to execute those runtime groups and the production dependency audit.
