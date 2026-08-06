# Classic Trip v1.6.4 — Deep Performance, Rolling Worker and Marketplace UI Repair

## Scope reviewed

This release reviews and repairs the actual source code for:

- Featured bus **Bars** layout and the Stays section header controls.
- Phone alignment of the Seat selection / Room selection badge and the layout switch.
- Rolling 30-day departure creation and daily far-end extension.
- Boarding and drop-off loading after selecting a departure.
- Proceed-to-payment and guest bus checkout latency.
- Dashboard pages that were fast with zero records but very slow after one real record existed.
- Existing edit-form hydration and page-scoped dashboard data from the v1.6.3 repair.

## Root causes and repairs

### 1. Rolling departure work was competing with the website

The web request created one departure and then continued materializing the rest of the month inside the same web process. That background work used the same MongoDB connection pool as dashboard navigation, departure creation and checkout.

v1.6.4 now:

- Creates one dated departure in the save request so the user receives a real immediate result.
- Leaves the remaining rolling window entirely to the background worker.
- Reconciles active rolling rules every **30 seconds** instead of every 15 minutes.
- Runs the worker automatically with normal `npm start` local/single-service startup.
- Keeps Render web and worker processes separate to prevent dashboard and checkout contention.
- Uses a bounded batch concurrency of two while generating the remaining dates.
- Carries the saved driver assignment into worker-created departures.
- Revalidates Draft rolling departures and publishes them when readiness becomes valid.

A vehicle operating permit failure remains a real publication blocker. The dates can exist as Draft, but they cannot be published until the permit reference and expiry are valid for the departure date. This compliance rule is not bypassed.

### 2. One dashboard record could create a very large HTML payload

A schedule row could include full route, seat-map, fare, seat-inventory and provider/request snapshots in dashboard metadata. This explains why pages were fast with zero data but slow as soon as one real record existed.

v1.6.4 now:

- Removes large immutable and provider payloads from dashboard row metadata.
- Keeps only edit-safe fields required by forms and detail views.
- Uses immutable lookup indexes for users, vehicles, routes, schedules, listings, bookings and payments instead of repeatedly scanning full arrays.
- Loads data by the active dashboard page and role.
- Keeps Live Departure Seat Maps limited to current operational departures and their related bookings.
- Logs snapshot and projection duration only when a dashboard is slow.
- Adds a `Server-Timing: company-dashboard` response header for deployment diagnosis.

No dashboard stylesheet, global margin, global padding, table height or workspace layout was redesigned in this repair.

### 3. Boarding and drop-off were unnecessarily locked

The selected departure already contained an immutable route summary, but the browser disabled the schedule, boarding and drop-off controls until the live seat query finished.

v1.6.4 now:

- Renders boarding and drop-off options immediately from the selected departure snapshot.
- Unlocks those controls before live fare and seat inventory finishes loading.
- Cancels the old request when the user changes the departure or a stop.
- Reuses cached immutable schedule context without deep-cloning a complete seat map on every click.

### 4. Checkout repeated database and payment-provider work

Guest bus checkout allocated many identifiers sequentially, repeated a held-schedule query and could repeat Pesapal token/IPN work.

v1.6.4 now:

- Resolves outbound and return held departures in parallel for the checkout page.
- Reuses canonical availability instead of querying the same held schedule again.
- Allocates booking, passenger, item, reservation, assignment and ticket identifiers in batches.
- Shares in-flight Pesapal authentication and IPN registration work.
- Reuses the registered Pesapal notification ID.
- Applies a controlled payment-provider timeout.
- Prewarms the active payment provider after server startup without blocking startup.

### 5. Marketplace Bars and Stays controls

v1.6.4 now:

- Uses two landscape bar cards per row on desktop and one landscape bar card per row on phones.
- Keeps the image on the left and details/actions on the right, matching the supplied reference layout.
- Keeps the Stays switch at the top beside the section title instead of dropping below.
- Keeps Seat selection / Room selection directly beside the layout switch on phones.
- Moves the description to a second header row on phones while the controls remain in the first row.
- Applies these rules only to the Bus and Stays marketplace section headers and bar cards.

## Required deployment behavior

### Local or one-server deployment

```bash
npm ci
npm run db:indexes
npm run release:check
npm start
```

`npm start` launches both the web server and the worker unless `RUN_BACKGROUND_WORKER=false` is explicitly configured.

### Render deployment

Sync the updated `render.yaml` Blueprint and make sure the `classic-trip-worker` service is running with:

```text
npm run worker
```

The Render web service intentionally uses `RUN_BACKGROUND_WORKER=false` because the dedicated worker performs rolling departures and other jobs. Do not disable the dedicated worker while leaving that web setting false.

After deployment, clear the old service worker or perform a hard refresh so v1.6.4 assets are loaded.

## Validation completed

- JavaScript syntax: **579/579 passed**.
- EJS syntax: **129/129 passed** using the dependency-free compiler.
- v1.6.4 focused deep-repair audit: **29/29 passed**.
- Performance/edit/payment audit: **19/19 passed**.
- Dashboard runtime repair audit: **15/15 passed**.
- Launch lifecycle audit: **35/35 passed**.
- Dashboard workflow relationship audit: **22/22 passed**.
- Add-on/return/seat audit: **30/30 passed**.
- Final payment and homepage audit: **39/39 passed**.
- Marketing mobile overflow audit: **27/27 passed**.
- Full verification command groups: **62/65 passed**.

The three unavailable verification groups did not reach source assertions because this execution environment could not install runtime dependencies:

- `check:platform-experience`: missing `ejs`.
- `check:runtime`: missing `mongoose`.
- `npm test`: tests importing repositories/models were blocked by missing `mongoose`.

`npm ci` was attempted, but the configured package mirror returned HTTP 404 for the locked `which-typed-array@1.1.20` tarball. No partial `node_modules` directory is included in the release archive.
