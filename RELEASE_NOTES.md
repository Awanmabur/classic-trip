# Classic Trip 1.6.15 — Preview Hierarchy, Worker Circuit Breaker and Listing Inventory Repair

Release date: 6 August 2026

## Main repairs

- Grouped route, travel time, boarding and drop-off controls inside a labeled container above Ticket class and Journey, with larger readable typography.
- Scoped preview flashes to red rectangular rounded cards instead of black translucent notices.
- Removed the desktop bar image baseline strip while preserving the approved compact image dimensions and unchanged phone bars.
- Corrected the Listings table's eight-column projection and loaded bounded recent departures so schedule counts and price/status columns align correctly.
- Prevented false seat-inventory warnings by scaling the seat-row read limit with the number of loaded departures.
- Replaced per-rule MongoDB outage retries with one queue-level circuit breaker and exponential backoff.
- Made vehicle overlap blockers action-required until the recurring rule is edited or resumed.
- Staggered scheduled-job launches and labeled web/worker MongoDB connections in startup logs.

See `PREVIEW_WORKER_LISTING_INVENTORY_REPORT_v1.6.15.md` for root-cause explanations and verification.

---

# Classic Trip 1.6.14 — Vision-Style Desktop Bars, Deterministic Red Seats and Rolling Queue Repair

Release date: 6 August 2026

## Main repairs

- Kept phone bars unchanged while giving desktop bars natural content height and a fixed compact 190 × 150 px image that cannot stretch with wrapped routes.
- Removed unnecessary desktop bar gaps and allowed route chips to expand the content side without clipping or hidden overflow.
- Added a visible divided gap after `DRIVER - FRONT` and centered the physical seat map with equal left/right tracks around the aisle.
- Made booking/ticket evidence authoritative and pinned every taken/occupied state red at both the render and final CSS layers; orange is now reserved for blocked/maintenance seats.
- Standardized origin/destination presentation as `Origin ⇄ Destination` across cards, previews, dashboards, manifests, archives and PDFs.
- Added rolling-conflict fields to the strict `ScheduleRule` schema, prevented active blockers from being extended, and changed the scheduled materializer to queue work and return before the cron deadline.
- Preserved the dedicated worker, fail-fast MongoDB, page-scoped dashboard, deferred JavaScript, preview-prefetch and bounded payment/listing speed architecture.

See `BAR_SEAT_ROUTE_ROLLING_FIX_REPORT_v1.6.14.md` for implementation details and verification.

---

# Classic Trip 1.6.13 — Natural Desktop Bars, Transactional Seat Repair and Precision Speed

Release date: 6 August 2026

## Main repairs

- Removed fixed desktop bar heights so bars follow their content and route chips wrap without clipping or internal scrolling.
- Restored the previously approved phone bar dimensions instead of applying the desktop correction to phones.
- Forced all occupied/taken seat states to red and centered the complete dashboard cabin and physical seat rows.
- Added safe transactional repair for departures with missing persisted seat inventory, including automatic publication recovery when no passenger activity exists.
- Replaced repeated vehicle-overlap rolling retries with a persisted six-hour conflict blocker that clears when the rule is edited or resumed.
- Disabled rolling work in direct web-server launches by default so user requests do not compete with background materialization.
- Preserved the v1.6.12 fail-fast MongoDB, page-scoped dashboard, preview/payment and deferred-JavaScript speed architecture.

See `PRECISION_SPEED_INVENTORY_REPAIR_REPORT_v1.6.13.md` for safety rules, performance details and verification results.

---

# Classic Trip 1.6.12 — Ultra-Speed Fail-Fast Preview, Payment and Dashboards

Release date: 6 August 2026

## Main repairs

- Eliminated the multi-minute MongoDB DNS/pool stall class with bounded connection, queue, query and write deadlines.
- Kept scheduled/rolling work out of the web process and aligned Render web/worker settings with the fail-fast defaults.
- Split dashboard boot into a tiny immediate shell plus an idle-loaded CRUD workspace.
- Reduced every role dashboard to active-page data and lower record caps, with a 30-minute stale fallback during brief Atlas outages.
- Removed third-party font/icon CSS from the render-critical path on login, dashboards and marketing pages.
- Added listing-preview prefetch, Redis-backed listing snapshots and smaller payment/listing cold reads.
- Increased bars to 198 px desktop and 190 px phone, with two visible wrapped route rows.
- Added spacing to `DRIVER - FRONT` and centered the visual seat map.

See `ULTRA_SPEED_END_TO_END_REPORT_v1.6.12.md` for the root-cause trace, exact limits and verification record.

---

# Classic Trip 1.6.11 — End-to-End Speed and Rounded Mobile Navigation

Release date: 6 August 2026

## Performance

- Stopped signed-out read-only marketing pages from creating a CSRF-backed server session on every visit.
- Stopped empty flash-message reads from dirtying and persisting anonymous sessions.
- Added safe short shared caching for anonymous marketing HTML with stale-while-revalidate and stale-if-error protection.
- Enabled production EJS view caching and explicit efficient response-compression settings.
- Reused country-market configuration process-wide instead of rebuilding it on every request.
- Added a second stale-while-revalidate cache for the fully derived homepage model, avoiding repeated mapping and aggregation of the complete catalogue.
- Kept the web process free of background read-model jobs; the catalogue warms lazily and refreshes in the background after serving a valid stale model.
- Changed the large dashboard workspace bundle so it no longer blocks `DOMContentLoaded`.
- Added browser `content-visibility` containment for below-fold marketing sections and footers.

## Mobile navigation

- Increased the phone bottom-navigation shell radius to 32–34px.
- Increased bottom-navigation item radius to 18–19px.
- Reduced expensive blur and transition work while preserving the approved rounded design.

## Verification

- Added `npm run check:v1611-speed-end-to-end`.
- Passed syntax and EJS checks plus the focused performance, CSRF, marketing-mobile, rolling-worker, dashboard, fare, payment, and safe v1.6.7 route/preview/navigation audits.

See `SPEED_150_END_TO_END_REPORT_v1.6.11.md` for the implementation record and performance-target note.

---

# Classic Trip 1.6.10 — Safe v1.6.7 Company Routes, Preview, Navigation and Rolling Repair

Release date: 6 August 2026

## Fixed

- Rebuilt directly from the safer v1.6.7 baseline.
- Added the missing `routes` and `routeStops` company repository collections that caused the rolling worker's `undefined.findOne` failure.
- Showed all active operator routes inside each bus card and Bars card without duplicating the card.
- Put route and travel date/time opposite each other, with boarding and drop-off opposite below, inside the existing journey container.
- Filtered departures when the route changes and cleared stale fare, seat and return state.
- Excluded return departures that are not strictly later than the outbound journey.
- Aligned the real homepage `header.nav`, shared top navigation, body containers, footer and phone bottom navigation to one width.
- Stabilized the five phone bottom-navigation actions.
- Restored dashboard **Price from** through a pre-indexed fare-product/segment fallback.
- Advanced application, asset and service-worker versions to `1.6.10`.

See `SAFE_V167_COMPANY_ROUTES_PREVIEW_NAV_ROLLING_FIX_REPORT_v1.6.10.md` for the complete implementation and verification record.

---

# Classic Trip 1.6.7 — Rolling Worker `undefined.findOne` Root Repair

Release date: 6 August 2026

## Fixed

- Reproduced the post-first-date worker branch with one existing dated departure and a pending rolling window.
- Removed the worker's `createScheduleSeries` repair path. Existing rolling windows now create each missing date through the same proven single-date `createScheduleBatch` path that successfully creates the first departure.
- A missing or expired operating permit remains a publication blocker only. The worker continues creating the remaining dates as Draft instead of pausing the whole rolling window.
- Internal runtime failures such as `Cannot read properties of undefined (reading 'findOne')` are no longer recorded as permanent skipped dates. They are tagged as bounded retryable worker failures.
- Worker retry logs now include the materialization stage, error code and stack trace, so a future repository contract failure is actionable instead of being reduced to one message.
- Added two runtime regression tests: one verifies that a rule with one existing departure creates the next Draft date, and the other verifies that `undefined.findOne` is not converted into `skipped=1`.
- Browser and service-worker asset versions were advanced to `1.6.7`.

## Existing data

No migration is required. After replacing 1.6.6 and restarting with `npm start`, the worker's startup repair scan finds `schedule-rule-11`, keeps the existing dated departure, and resumes filling the missing far-end dates one at a time. The dates remain Draft until the vehicle has a valid, unexpired operating permit.

## Verification in the repair environment

- New rolling worker regression tests: 2/2 passed.
- Rolling worker source audit: 7/7 passed.
- Performance/edit/payment repair audit: 23/23 passed.
- JavaScript syntax and all dependency-free project checks were run successfully as listed in the repair report.
- Full `npm ci` could not run in this environment because the configured package mirror returned HTTP 404 for `which-typed-array-1.1.20.tgz`. Run the complete release check in the user's normal npm environment.

---

# Classic Trip 1.6.6 — Root Performance, Current Fare, Rolling Worker and Public UI Repair

Release date: 6 August 2026

## Root causes removed

### The web server no longer creates the remaining rolling month

- In 1.6.5, `npm start` correctly launched a worker, but the web process could still accept local rolling-queue jobs after the save request. The web server therefore continued performing dated-departure transactions while serving dashboards, live fare requests and checkout.
- The dedicated worker is now the only in-memory rolling-queue owner under normal startup. Production web processes default to no fallback; a genuinely standalone web service must opt in with `WEB_ROLLING_FALLBACK=true`.
- The save request creates one dated departure for immediate confirmation. The worker creates the remaining dates one at a time with a two-second yield, begins after the redirect burst, and uses the existing per-rule distributed lease.
- Dashboard cache invalidation is delayed until the rolling drain settles instead of making every dashboard request cold after every created date.
- Repeated permit, insurance, inspection or other publication-readiness failures are cached for five minutes. Missing dates can still be created as Draft without running the same expensive failed publication validation for every date.
- Permanent validation errors pause until the repair scan instead of hot-looping. The stale release assertion that rejected this safe behavior was updated.

### Current fare and payment no longer read the full dated inventory

- Bus availability reuses the immutable route, seat-map and fare snapshots already stored on the selected departure.
- Detailed segment-fare rows are fetched only when an old schedule lacks the required snapshot or when an intermediate stop pair needs them.
- Segment inventory reads are bounded to the selected journey and selected seat numbers.
- Listing, availability and payment contexts use a listing-scoped catalogue snapshot instead of loading the complete marketplace and every compatibility Seat row for all rolling dates.
- Identical live-fare calls are deduplicated, boarding/drop-off changes are debounced, and the live request has an eight-second timeout.
- The preview fare remains visible while live seat availability is confirmed, and return departures load after the outbound result rather than blocking it.
- The selected departure cache remains valid across the immediate hold-to-payment redirect. Payment-provider network calls use bounded six-second timeouts.

### Dashboard reads remain active-page scoped

- Dashboard snapshots continue to load only the entities required by the active page.
- Live seat-map reads remain scoped to the selected company schedules and related bookings.
- Successful writes invalidate only affected role/page snapshots instead of globally clearing every dashboard cache.
- Repository reads support field projections so page services can avoid hydrating unused document fields.
- Most importantly, the web process no longer competes with rolling creation while serving dashboards.

### Public card and shell alignment

- Bars use a wider horizontal image column on desktop and phone.
- The service badge is fixed at the image’s bottom-left and the rating/New badge at the bottom-right.
- Phone bar descriptions remain visible as one small ellipsized line.
- Header, body, footer and phone bottom navigation now share the same outer width.
- Existing Seat Selection/Room Selection and layout-switch controls remain together on phones.

### Publication status

A missing or expired vehicle operating permit remains a legitimate publication blocker. Rolling dates can be created as Draft, but they are not published until the vehicle has a valid, unexpired permit. The full blocker message is no longer truncated mid-word.

### Verification completed in the repair environment

- JavaScript syntax: 580/580.
- EJS syntax: 129/129 using the dependency-free compiler.
- Final payment/home release: 47/47.
- Dashboard root performance, live seat maps, rolling and capacity: 24/24.
- Performance/edit/payment repair: 23/23.
- Root performance/current-fare/rolling/UI audit: 35/35.
- Deep cleanup: 26/26; launch lifecycle: 35/35; architecture/security: 66 dashboard sections with the shared workspace reduced to 58,315 bytes.
- After the dependency-bound platform-experience gate, 37 additional verification commands passed. `check:runtime` and `npm test` could not load `mongoose`; platform-experience could not load `ejs`. Package installation was unavailable in this repair container, so runtime unit, live MongoDB and browser timing checks must be run after `npm ci` in the deployment environment.

---

# Classic Trip 1.6.3 — Performance, Edit Forms, Payments and Rolling Worker Repair

## Fixed

- `npm start` now supervises both the web server and the background worker in single-service/local deployments, so rolling departure outbox events and the daily far-end date are actually processed. Set `RUN_BACKGROUND_WORKER=false` only when a separate worker process is deployed.
- Rolling-rule saves materialize one dated departure immediately for confirmation, return quickly, and queue the remaining missing dates. Draft departures now show their exact readiness blockers instead of reporting misleading success. The worker retries Draft dates every 15 minutes and publishes them automatically once readiness is complete.
- Dashboard snapshots are page-scoped across Super Admin, Company, Employee, Driver, Customer and Promoter roles; live seat maps read only current schedules and their related bookings.
- Edit forms normalize `date`, `time`, and `datetime-local` values and resolve nested dashboard records, restoring existing values, blocked seats, drivers, policies, stay timing, amenities and operating instructions.
- Pesapal IPN registration is cached for 24 hours, all payment-provider calls have bounded timeouts, and unrelated mutations no longer rebuild the complete public marketplace catalog.
- Departures & Fares and Live Departure Seat Maps use the platform’s original compact `tableTools` layout; no new global margin, padding or card redesign was added.
- Static production assets cache for 30 days, home catalog cache defaults were increased safely, Cloudinary is preconnected, and non-critical public images lazy-load.

---

# Classic Trip 1.6.2 — Dashboard Runtime and Rolling Departure Repair

Release date: 6 August 2026

## Changes in this release

### Rolling departures now create real dated departures

- Saving, updating, or resuming an active rolling rule now materializes its current 30-day window before a success message is shown.
- The result message reports the actual number created, already existing, published, kept as Draft, or skipped; it no longer says records were queued when none exist.
- Active rules with no dates in the current window now return an actionable validation message instead of a false success.
- Request, outbox, and daily-worker materialization share a per-rule distributed lease, while the unique schedule index remains the final duplicate guard.
- The daily worker still rechecks the complete live window and adds the next far-end day automatically.

### Dashboard forms and filters

- Fixed the shared browser validation crash caused by calling `filter()` on a single DOM element. This blocked create and update forms across company and administrative dashboards.
- Departures, recurring rules, fare products, stop-to-stop fares, add-ons, and live seat-map tables now have working search, status, and reset controls.
- Seat-map selection and table filtering now work together without resetting one another.
- Status filters use normalized exact-word matching, so values such as Active no longer incorrectly match Inactive.

### Login and page-loading performance

- Login now saves the authenticated session and redirects without launching a second competing dashboard prewarm request.
- Dashboard snapshots are page-scoped and capped instead of loading full company or platform history on every navigation.
- Live Departure Seat Maps loads only current operational departures and bookings tied to those departure IDs.
- Departures & Fares excludes archived and distant historical schedules and no longer loads large seat-segment inventory collections it does not render.
- Overview, customer, promoter, admin, support, finance, hotel, flight, and mobility snapshots use bounded entity-specific reads.
- New MongoDB indexes cover company/status/date schedule reads and schedule-scoped booking lookups.

### Deployment safety

- The dashboard JavaScript and service-worker cache are versioned as `1.6.2`, preventing clients from retaining the broken form code after deployment.
- `npm run verify` now includes the dedicated dashboard runtime repair audit.

### Verification performed

- 69 of 71 source-level project checks passed, including syntax, EJS source validation, security architecture, route security, CSRF, dashboard scope, role/service coverage, bus/stay/flight/mobility workflows, UI responsiveness, rolling departures, and regression gates.
- The two remaining checks require installed runtime packages (`ejs` and `mongoose`). They could not run in the repair environment because the configured package mirror did not contain a locked dependency tarball; this is an environment installation limitation, not a reported source assertion failure.
- Run `npm ci`, `npm run release:check`, `npm run db:indexes`, and a real MongoDB/browser smoke test in the deployment environment before production rollout.

---

# Classic Trip 1.6.0 — End-to-End Dashboard and Stay Experience Repair

Release date: 5 August 2026

## Changes in this release

### Stay and room experience

- Public stay inventory now uses accessible accommodation cards instead of bus-seat styling.
- Each room choice shows availability, capacity, bed type, amenities and the nightly price with clear selected and unavailable states.
- Partner room operations use a responsive room-unit grid with floor, wing, housekeeping, occupancy and guest context.
- The design remains scoped to Stays and preserves the approved public and dashboard shells.

### Role-safe dashboards

- Customer, promoter, support, finance, operations, content, employee, driver and all seven partner-service dashboards are rendered and checked independently.
- Dashboard sections now follow the role menu, preventing unrelated hidden admin or company mutation forms from leaking into other role pages.
- Primary and quick actions route to real role-owned workflows; duplicate hard-coded create handling was removed.
- Promoters can create referral links, and drivers can record assigned-trip updates, incidents, handovers and profile changes through dedicated protected routes.
- Operations oversight is read-only where no mutation contract exists, while company and employee controls remain available only on their authorised endpoints.

### Setup, departures and accessibility

- Bus setup progresses from two terminals to the connected service wizard, route, vehicle, fare plan and rolling departures.
- Stay setup progresses from listing to property, room type, physical room units and room-night inventory.
- Rolling departures remain a 30-day default and no longer fall back to Draft merely because a driver has not yet been assigned.
- Dashboard dialogs now expose dialog semantics, keyboard focus trapping, Escape handling and focus restoration.
- Inputs, selects and text areas retain a visible keyboard focus indicator.
- Release cleanup uses a writable temporary npm cache so the verification gate is portable across restricted build environments.

### Verification

- A new platform-experience gate renders every role and partner-service shell, tests progressive bus/stay setup stages, and checks role-safe actions, driver validation, accessibility and stay layouts.
- The full syntax, EJS, architecture, security, CSRF, route, dashboard, UI, bus, hotel, flight, taxi, seven-service and unit-test suites remain part of `npm run release:check`.

## Previous v1.5.0 changes

### Bus ticket selection

- Standard Ticket and VIP Ticket are separate, opposite choices with live departure counts.
- Ticket class follows the dated departure's versioned whole-vehicle class through search, availability and booking preview data.
- One-way Ticket and Return Ticket are separate journey choices.
- Selecting Return Ticket keeps the return panel visible. If no matching reverse departure exists, the passenger receives a clear availability message instead of the choice disappearing.
- Return searches keep the same ticket class in both directions and still require an explicit return schedule and equal traveler-seat counts.

### Rolling departure automation

- The normal partner departure action now creates an indefinite rolling schedule rule by default.
- The worker materializes exactly 30 calendar days and adds one new far-end day each day.
- Partners can restrict the rule to selected operating weekdays or choose a one-off departure when needed.
- Materialization watermarks move forward atomically and generated rule/date pairs have a unique database index for concurrent-worker safety.
- Materialization reporting now retains published and Draft reconciliation counts.

### Dashboard setup and reliability

- Bus partners can create the required terminal before opening the guided service wizard.
- Stay partners can create the required public listing before adding a property and room hierarchy.
- Tour, car-rental and cargo partner dashboards no longer fall through to super-admin quick actions.
- The final verification gate now checks ticket-class propagation, return visibility, the rolling default, watermark safety and every repaired setup entry point.

## Previous v1.4.10 changes

### Faster Proceed to payment

- Checkout preparation no longer loads full bus availability twice before creating the secure seat hold.
- The payment page reuses the marketplace snapshot already loaded for the request.
- Return-departure discovery is skipped on the payment page because the selected return journey is already stored in the secure draft.
- Hold-item identifiers are allocated in one MongoDB counter operation instead of one operation per seat segment.
- Compatibility seat records are recalculated in a single batched read/write path instead of repeated per-seat queries.
- Checkout no longer runs a global stale-hold sweep. Expired holds affecting the selected seats are released immediately, while the normal expiry job handles general cleanup.
- Existing draft reuse, double-click protection, inventory conflict checks and double-booking prevention remain active.

### Homepage cards

- Desktop card mode keeps exactly three fixed columns in every marketplace section.
- One or two listings remain in their normal column widths and do not stretch to fill the row.
- The phone Featured Buses rail still uses two rows, but now reveals about one quarter of the next card column instead of half a card.
- Decorative section color overrides added in the previous release were removed. The existing platform palette is used unchanged.

### Compact bar mode

- Bar images are wider on desktop and phones.
- Availability badges are placed in the top-right corner of the full bar.
- Bar content reserves space for the badge so it does not cover the title or description.
- Desktop descriptions use one line with ellipsis truncation.
- Bars remain one per row on phones and two per row on desktop.

### PWA caching

- The service-worker cache is `classic-trip-static-v1.4.10`.

## Verification

Run:

```bash
npm ci
npm run check:final-home-payment
npm run release:check
npm start
```
