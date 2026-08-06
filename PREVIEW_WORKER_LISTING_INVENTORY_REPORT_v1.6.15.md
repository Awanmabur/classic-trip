# Classic Trip v1.6.15 — Preview Form, Worker Recovery, Listing Inventory and Seat Diagnostics

Release date: 6 August 2026

## User-facing corrections

### Bus preview selection order

The four dependent travel selectors are now grouped in a bordered **Route & travel** container above **Ticket class** and **Journey**:

1. Select route
2. Select the route's travel date and time
3. Select boarding stop
4. Select drop-off stop

The existing selector IDs and JavaScript contracts were preserved. Group labels, ticket choices, helper text and select controls now use larger readable type.

### Preview flash messages

Preview-page flashes are scoped through `listingPreviewBody`. They now render as rectangular red cards with 14px rounded corners, white text and no black translucent background. Other public pages keep their existing flash styles.

### Desktop listing-bar images

The approved compact desktop image dimensions remain unchanged. The image is now a block-level element with zero line-height, flush margins and matching left-side rounded corners. This removes the browser inline-image baseline strip without stretching the image or changing the phone bars.

## Why the seat-inventory warning appeared

A dated departure is stored separately from its persisted seat rows. The warning means the schedule/departure document exists, but the dashboard did not find its canonical seat inventory rows. This can happen when:

- a legacy departure was created before canonical transactional inventory;
- the selected vehicle template was not published when the departure was created;
- an older write was interrupted before all seat rows were persisted; or
- the dashboard's previous fixed 1,800-seat read cap truncated seat rows for a large set of departures and produced a false missing-inventory warning.

v1.6.15 scales the seat read limit according to the number of loaded departures, up to a bounded maximum. The warning copy now states that persisted seat rows are missing. The existing repair action remains transactional and refuses automatic repair when passenger bookings, tickets, active holds or occupied seat states make rebuilding unsafe.

## Departures and tickets are not recreated on every scan

A recurring schedule rule is a template. The rolling worker checks the next 30 days, compares expected date-times with dated departures already stored in MongoDB, and creates only missing dates. Existing dated departures are retained. The daily rolling behavior normally adds only the new far-end date as the window moves.

The materializer does not create customer tickets. Tickets are created only by the booking/payment flow. Previous repeated log lines were scans and retries, not proof that tickets were recreated.

## MongoDB and rolling-worker correction

### Two MongoDB connection messages

`npm start` launches two processes:

- the web process, which serves pages and APIs;
- the worker process, which runs outbox, payment expiry, rolling schedules and other jobs.

Each process requires its own MongoDB connection, so two connection messages are expected. v1.6.15 adds `process=web` or `process=worker` to the connection log so this is explicit.

### Mongo outage circuit breaker

Previously, one Atlas/DNS outage caused every queued schedule rule to fail and retry separately. v1.6.15 now:

- returns the current rule to the queue;
- pauses the entire rolling queue once;
- uses exponential backoff from 15 seconds to a five-minute maximum;
- logs one concise queue-level warning per backoff period;
- does not increase each rule's retry count during a database outage; and
- resumes the same stored work after MongoDB returns.

### Vehicle overlap conflicts

A vehicle schedule overlap is deterministic and cannot be fixed by retrying. These blockers are now action-required and remain excluded from materialization until an operator edits or resumes the recurring rule. Editing/resuming clears the blocker. This also handles blockers created by v1.6.14 because the `vehicle_schedule_conflict` code itself is treated as action-required.

### Cron bursts

Scheduled jobs that share the same cron second are now staggered by small deterministic delays. This reduces simultaneous MongoDB and CPU bursts after process sleep or event-loop recovery. Node-cron may still report a missed execution if the whole operating system/process is suspended, but jobs no longer all launch together when execution resumes.

## Dashboard listing-row correction

The Listings table has eight columns. The old projection emitted only six display cells, causing route, inventory, status and price values to appear under the wrong headings. v1.6.15 emits:

1. Listing
2. Type
3. Partner
4. Inventory
5. Country route/location
6. Badge/status
7. Price from
8. Actions

The company Listings page now requests recent dated schedules. Legacy schedule rows without `listingId` are counted only when their company-owned route and vehicle both resolve to the same listing. This fixes incorrect `0 schedules` counts without weakening tenant isolation.

## Verification

- JavaScript syntax: 594/594
- EJS dependency-free syntax: 129/129
- v1.6.15 focused checks: 18/18
- Dashboard workflow relationships: 22/22
- Dashboard service coverage: 68/68
- Launch lifecycle: 35/35
- Root performance/current-fare/rolling/UI: 35/35
- Payment and homepage: 47/47
- Production bus workflow: 28/28
- Final regression: 42/42
- Post-render dependency-free command groups: 44/44

The full verification chain passed through dashboard service coverage. Runtime renderer checks could not start because this execution environment's internal npm mirror returned a 404 for `which-typed-array@1.1.20`, preventing `npm ci` from installing `ejs` and `mongoose`. No `node_modules` directory is included in the release.
