# v1.6.50 — Redis homepage handoff and cold-deploy speed

- Added a compact compressed Redis snapshot for the fully rendered public Home bootstrap, separate from the much larger raw catalog snapshot.
- On Render restart/deploy, Home now hydrates the last known-good bootstrap from Redis before waiting on MongoDB catalog warmup.
- Added stale-while-revalidate behavior: a valid shared Home snapshot is returned immediately while live catalog/airport data refreshes in the background.
- Kept MongoDB authoritative for booking, inventory mutation, holds, payments and all writes; the new Redis snapshot is read-only discovery acceleration.
- Preserved the existing 2.5-second cold-load safety deadline for the true first-ever cache miss, while removing that wait from normal redeploys after Redis has been warmed once.

# v1.6.49 — Render cold-start and inventory continuity recovery

- Removed the brittle Pesapal exact-host startup restriction that rejected a safe `www`/canonical/infrastructure callback alias and prevented Render from opening a port. Production callbacks and IPNs must still be public HTTPS URLs without URL credentials or local/private-network destinations.
- Pinned Node.js to the tested `24.x` LTS line so Render can no longer select an untested future major from `>=20`.
- Added non-blocking marketplace prewarming immediately after the HTTP listener opens. Render health/port checks remain independent of Mongo catalog hydration.
- Added a compressed Redis copy of the last successful full public catalog. A restarted web process can serve known-good discovery inventory immediately while refreshing in the background.
- Added a 24-hour emergency stale window for discovery only. Booking, seat/room holds, payment, ticketing and all mutations remain authoritative live-database operations and fail closed during an outage.
- Applied the public catalog outer deadline to search and all service/partner discovery pages, not only Home and listing-scoped pages.
- Corrected fallback wording: an unfinished cold load says inventory is loading; a confirmed Mongo/database error says inventory is temporarily unavailable.
- Added a production warning when Redis is not configured, making missing shared sessions/catalog cache visible instead of silently degrading.
- Added a 14-point v1.6.49 regression gate covering the exact Render failure, public-HTTPS callback security, post-listen warming, shared compressed inventory, bounded catalog pages, Node pinning and production deployment commands.

## Deployment contract

Use `npm ci && npm run release:check && npm prune --omit=dev` as the Render build command, `npm start` as the web start command, and `/ready` as the health-check path. Set `RUN_BACKGROUND_WORKER=false` on the web service when the dedicated `classic-trip-worker` service is running. Configure `REDIS_URL` and `REDIS_REQUIRED=true`; without Redis, the process can still warm its memory cache but cannot preserve inventory or sessions across deployments.

# v1.6.48 — Rolling worker Mongo outage aggregation

- Classified raw `MongoNetworkTimeoutError` names and the driver message `connection … to …:27017 timed out` as database unavailability in the rolling queue.
- One socket outage now requeues the current rule and pauses the whole rolling queue with bounded exponential backoff instead of spending attempts and emitting a warning for every rule.
- Added explicit `web` and `worker` process identity for direct launches and rolling outage logs; `npm start` retains the separate worker architecture.
- Added exact unit coverage for the reported Atlas timeout and ordinary validation errors, plus an eight-point v1.6.48 release gate.
- Advanced package, lockfile, semantic assets and Service Worker cache to `1.6.48` while preserving v1.6.47 secret protection and all earlier launch functionality.

# v1.6.47 — Secret-fixture cleanup and deployment configuration guard

- Removed the credential-shaped fake MongoDB URI from the production startup regression and replaced it with a reserved, credential-free `.invalid` endpoint that is never contacted.
- Removed full `process.env` inheritance from the child validation process; only operating-system variables needed to launch Node are allowlisted, while every application value is synthetic and isolated.
- Added `check:v1647-secret-regression` to the full release and backend verification chains so committed credential-bearing MongoDB URIs and a future full-environment spread fail the build.
- Retained strict same-host HTTPS validation for `APP_URL`, Pesapal callback and Pesapal IPN URLs. The Render environment must be corrected rather than weakening payment callback security.
- Advanced package, lockfile, semantic assets and Service Worker cache to `1.6.47` while preserving the v1.6.46 Mongo outage deadlines and all earlier launch functionality.

# v1.6.46 — Render startup repair and MongoDB outage fail-fast

- Fixed the production-only `ReferenceError: appUrl is not defined` in environment validation by retaining the parsed application URL for Pesapal callback/IPN host checks.
- Added a production-like Pesapal startup regression that executes the real environment validator before each release can pass.
- Bounded cold public listing database waits at 6.5 seconds and Home bootstrap waits at 2.5 seconds, retaining stale/degraded fallbacks where available.
- Stopped retrying an already-spent MongoDB network socket timeout and reduced the configured web/worker socket deadline to eight seconds.
- Normalized MongoDB connectivity failures to a controlled `503` response with a safe reconnect message instead of an internal-server-error page.
- Advanced package, lockfile, semantic assets and the Service Worker cache to `1.6.46`.

# v1.6.45 — Runtime media repair, real dashboard actions and launch hardening

- Added a shared presentation-media resolver so the seven launch guides and six researched bus operators show meaningful travel/coach photographs even when an existing MongoDB row still contains a Classic Trip logo. Real editor/operator uploads always take priority.
- Kept the approved three-blog Home layout and bottom-right **More blogs** link; the full published directory remains at `/blogs`.
- Changed overview Quick Actions into real role-scoped page links. Their destination page loads its normal data and opens the same validated CRUD action used by that page, instead of launching an incomplete overview-only modal.
- Added a safe Home reconnect state during initial MongoDB unavailability, aggregated missed scheduler executions, and enabled cron non-overlap to prevent laptop/container resume log floods.
- Made rolling departure materialization use each rule's IANA timezone rather than the web/worker host timezone, while retaining Draft/readiness protection and the rolling 30-occurrence repair behavior.
- Restored `.env.example` to deployment/source packages and added a 33-point v1.6.45 launch functionality gate covering public media, Home, Quick Actions, role boundaries, CSRF, rate limits, scheduler resilience, departures and packaging.
- Advanced package, lockfile, semantic assets and the Service Worker cache to `1.6.45`.

# v1.6.44 — Three-blog Home preview, real coach media and departure drafts

- Restored the intended three-card blog preview on Home and added a bottom-right **More blogs** button linking to the complete `/blogs` directory.
- Replaced seeded Classic Trip logo placeholders with seven meaningful travel/coach photographs; rerunning the seed upgrades only blank or legacy-logo blog images and preserves custom editorial uploads.
- Added genuine coach photographs for all six researched launch operators, with explicit photo sources and a narrow image-host CSP allowlist.
- Added one editable research **Draft** departure per seeded operator from identified public timetable references. These records are visible for Partner Admin review but cannot be published or booked until the operator confirms the timetable and adds compliant vehicle, seat-map and fare inventory.
- Advanced package, lockfile, semantic asset versions and Service Worker cache to `1.6.44`.

# v1.6.43 — Blog presentation + seeded Partner Admin accounts

- Home now exposes all seven seeded SEO/travel posts instead of truncating the feed at four.
- Added responsive blog card/bar directory and a fully styled article preview page with the shared site head, related guides and internal travel CTAs.
- Launch operator seed creates one editable Partner Admin account per seeded coach operator and writes newly generated one-time temporary credentials to ignored `seed-output/partner-credentials.json`; reruns do not overwrite that file with blank passwords.
- `npm run seed:partner-credentials` intentionally resets only seeded launch Partner Admin passwords when credentials are lost.
- Existing seeded operator records are enriched only where fields are blank/placeholders; compliance/legal/vehicle identities are never fabricated as verified facts.

# Classic Trip 1.6.42 — SEO Launch Content, Operator Onboarding Seeds & Pesapal Hardening

- Added seven original, editable, published SEO/customer-acquisition travel guides owned by the active Super Admin seed account.
- Added an insert-only launch seed for Bebeto Coach Services, Trinity Express, Zawadi Travel Service, ECO Bus, Friendship Bus and YY Coaches with researched routes, terminal/office records, operator contacts where publicly supported, and unassigned staff-role slots.
- Seeded operator companies/listings remain Pending/Draft/Review: no staff names, vehicle plates, registration numbers, licences, permits, insurance, inspections or live schedules are fabricated.
- Added source/confidence and operator-confirmation notes so Super Admin can reconcile public research with signed onboarding information before approval/publication.
- Added `seed:launch-content:dry` and `seed:launch-content`; the normal `npm run seed` now creates the Super Admin first and then applies the non-destructive launch content seed.
- Hardened Pesapal API 3.0: fixed the missing platform-currency import, validates merchant references/amount/contact data, honors provider token expiry, reuses existing IPN registrations via GetIPNList, validates HTTPS callbacks/IPNs and Pesapal checkout hosts, and rejects incomplete/mismatched transaction-status responses.
- Pesapal IPN handling supports GET/POST and returns the provider acknowledgement shape only after server-side GetTransactionStatus processing. Browser callbacks remain untrusted.
- Payment initiation responses no longer expose stored provider raw payloads to the browser.

# Classic Trip 1.6.41 — Core Repair: Rolling Inventory, Roles, Listing Review & Booking Alerts

- Reworked rolling-window targeting to maintain the intended number of future recurring occurrences instead of allowing valid rules to shrink as departures leave the window.
- Rule-generated departures now queue immediate materialization when they move to departed, arrived, completed, cancelled or archived; the periodic worker remains a fallback.
- Preserved full vehicle-overlap protection and v1.6.40 `action needed` behavior for genuinely impossible recurring schedules.
- Restored Super Admin listing Approve/Reject with service-specific publication/readiness validation, audit state and targeted dashboard-cache invalidation.
- Fixed a dashboard JavaScript TDZ error where listing review actions referenced `id` before it was declared.
- Repaired overly narrow Super Admin page data plans while preserving page-scoped dashboard performance.
- Kept the v1.6.39 hardened single-login/partner-signup flow after role/auth audits passed; no broad rollback was applied to working auth.
- Restored explicit notification-center card padding and list spacing on desktop and mobile.
- Added operational booking notifications for Partner Admin and Super Admin, with immediate Service Worker signaling to open dashboards and a browser booking chime plus polling fallback.
- Changed eligible referred Uganda-currency promoter rewards to a fixed UGX 2,000 funded from Classic Trip commission, preserving partner payout.
- Centralized Uganda-specific pricing/reward currency policy in Platform Settings and removed obsolete one-off runtime release reports from `/docs`.

# Classic Trip 1.6.40 — Clean Mongo Index & Actionable Rolling Conflicts

- Removed the duplicate `PlatformActivity.expiresAt` schema index declaration; the field now uses only the intended TTL index, eliminating the Mongoose duplicate-index startup warning.
- Full-window vehicle conflicts are now distinguished from ordinary date-specific conflicts. A partial conflict still skips only the affected date and continues scanning later dates.
- When every missing rolling date is blocked by departures generated from recurring rule(s), Classic Trip persists a `vehicle_schedule_conflict_window` action state instead of re-scanning the same 30-day window every repair cycle.
- Full-window conflict blockers expire after six hours as a safety re-check, but editing/pausing a referenced blocking recurring rule clears dependent blockers immediately and queues them for re-materialization.
- Partner Admin recurring-rule rows now show `action needed` plus the blocking recurring-rule IDs and preserve the detailed reason in the record drawer.
- Worker logging for deterministic full-window conflicts is concise: it records the blocking rule IDs/reason once instead of repeatedly dumping dozens of identical date conflicts.
- Preserved v1.6.39 partner signup stabilization, v1.6.38 dashboard performance/SMS delivery, return-ticket logic, notification repairs, pricing, monitoring, SEO and canonical `https://www.classictrip.org` behavior.

# Classic Trip 1.6.33 — Final Runtime Stability

- Fixed bus From/To/date search so a valid second, third, or later route in the same company listing is matched correctly.
- Bus date search now validates against the selected route's live published departures and carries the matched route/schedule into the listing URL.
- General marketplace search dynamically constrains Bus From/To to valid database-backed pairs when the user switches the Service selector to Bus.
- Fixed Company Notifications routing and made notification pages render the live notification API across dashboard roles.
- Added Content Admin to the notification API authorization set and cleaned notification-page wording.
- Vehicle conflicts are now date-specific during rolling materialization: one bad date is deferred while later free dates remain eligible.
- Initial rolling materialization cannot range-batch through a date that was deliberately skipped by conflict preflight.
- New/edited/resumed active recurring rules reject obvious same-vehicle recurring overlaps before they are saved.
- Missing permits, inspections, insurance and genuine vehicle overlaps remain safety blockers for the affected departure rather than being bypassed.

# Classic Trip 1.6.32 — Return Trips, Notifications, Global Contact & WWW Domain

- Return-trip discovery now treats the return as an independent reverse service instead of requiring a matching outbound arrival time. A valid future reverse departure only needs to be published, reverse the selected journey, remain future/bookable, and depart after the outbound service starts. The reverse leg may use a different Standard/VIP vehicle class.
- Reverse journey identity now accepts route-specific stop IDs, canonical branch IDs, or normalized location names, fixing return checkout on independently-created reverse routes.
- Recovered/reacquired return seat holds now use the same flexible reverse-journey validation instead of falling back to exact stop-ID equality.
- Notification read state is persisted end to end, including mark-one and mark-all-read actions.
- Admin notification campaigns always create an in-app notification and can also deliver push, email, SMS, or WhatsApp.
- Browser push now re-syncs an existing subscription after login/redeploy, reports connection status, and includes a real Test push action.
- In-app notification loading no longer depends on Service Worker availability, so the notification center still works on browsers/devices where Web Push is unavailable.
- Added `npm run push:generate-keys` to generate VAPID keys locally without exposing the private key in source control.
- Added a global floating Classic Trip contact hub on public pages and dashboards with WhatsApp group, WhatsApp chat/call entry, and direct phone call using +256781977217.
- Canonical production origin, SEO URLs, payment callbacks and deployment guidance now use `https://www.classictrip.org`.

# Classic Trip 1.6.31 — Real Domain, Rolling Replacement & DB Search

- Canonical production origin is `https://www.classictrip.org`; production HTTP redirects to HTTPS.
- Rolling windows now replace a departed same-day occurrence at the far edge on the next materializer pass instead of waiting for the following calendar day.
- The dedicated worker runs the materializer every 15 minutes, so a healthy production worker normally creates the replacement within the next 15-minute rolling worker pass.
- Expired vehicle-conflict blockers automatically retry after a 15-minute cooldown instead of freezing a recurring rule indefinitely.
- Public From/To/location searches now use published database inventory (routes, listings, airports and service locations) instead of arbitrary typed route values.
- Home, marketplace search, public route directory and flight search use DB-backed selectors. Taxi exact-location search remains DB-backed autocomplete/current GPS because ride dispatch requires coordinates.
- Render is wired to `www.classictrip.org`, and the generated IndexNow key is included in production configuration.

# Classic Trip 1.6.30 — Strong SEO & AI Discovery

- Added clean, indexable service landing pages for buses, stays, Airbnb-style homes, tours, car rentals and cargo.
- Faceted `/search` pages are now `noindex,follow` to avoid duplicate/query-index bloat.
- Added split XML sitemap index for static pages, listings, verified companies and blog posts with accurate `lastmod` behavior.
- Added `X-Robots-Tag` protection for private, dashboard, checkout, ticket, API and tracking pages.
- Separated AI search/user crawlers from training crawlers in `robots.txt`; AI search is enabled while AI training remains opt-in.
- Expanded `llms.txt`, `llms-full.txt` and added `/ai-index.json` for machine-readable public catalog discovery.
- Strengthened canonical, Open Graph, Twitter, breadcrumb and JSON-LD metadata for public pages, listings, companies and blogs.
- Added production SEO verification/IndexNow environment hooks and a release SEO validation gate.

# Classic Trip 1.6.29 — Ticket Class/Journey Active Border Match

- Standard/VIP now use the exact same inactive and active border treatment as One-way/Return.
- Removed the old Ticket-class-only border exception instead of adding another conflicting override.
- Preserved the existing ticket-first flow, black preview notifications, and production-clean v1.6.28 changes.

# Classic Trip 1.6.28 — Final Production Clean Release

- Removed obsolete one-off v1.6.x repair reports from the production source tree.
- Removed the orphaned v1.6.23 preview check script and an empty vendor asset directory.
- Consolidated the permanent release-consistency gate and added it to `npm run verify`.
- Aligned package, lockfile, service-worker cache, README, and deployment checklist to 1.6.28.
- Preserved all current ticket-class, journey, route, preview-toast, seat inventory, rolling departure, performance, security, payment, dashboard, and responsive UI fixes.
- Updated all internal semantic asset cache keys to `1.6.28`, preventing stale v1.6.16 browser assets after deployment.
- Hardened the Render blueprint to run `release:check`, run the production launch doctor before index reconciliation, require a live HTTPS taxi-routing endpoint, share VAPID push configuration with the worker, and use the correct `OUTBOX_BATCH_SIZE` key.

# Classic Trip 1.6.16 — Ticket Class Order, Balanced Bars and Light-Mode Badge Repair

Release date: 7 August 2026

## Main repairs

- Reordered the bus preview workflow as Route & travel → Ticket class → Journey.
- Removed the ticket-class auto-fallback that could switch VIP back to Standard.
- Returned desktop preview typography to compact sizing and kept only a modest phone-only increase.
- Reduced the desktop bar image width to 176px while keeping the phone bar at its approved 148px × 154px layout.
- Matched bar body spacing to the card rhythm and reduced the two overlay badges inside bar images.
- Increased phone bar text slightly without changing phone bar dimensions.
- Fixed the top-right green availability badge so its text and icon remain readable in light mode.


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


## v1.6.17
- Restored desktop Ticket class and Journey to side-by-side layout above their controls.
- Preserved stacked phone layout and all v1.6.16 behavior.


## v1.6.19
- Fixed bus preview order: Ticket class and Journey now appear above Route & travel and are selected first.


## v1.6.20
- Fixed bus preview flow so Ticket class and Journey can be selected first before the route section.


## v1.6.21
- Real ticket-first flow: Ticket class is step 1, Journey is step 2, and Route & travel unlocks as step 3.

## v1.6.23
- Standard and One-way selected by default in preview.
- Removed extra dark preview selector styling.
- Fixed preview phone toast/flash style to wide red rounded rectangles.


## v1.6.24
- Restored black preview flash background and removed the added border.

## v1.6.25
- Removed the extra dark border around the Ticket class preview group.

## v1.6.27
- Removed the remaining dark inner border from Ticket class and its Standard/VIP buttons.

## v1.6.33
- Final stability: fixed DB route/date search across all listing routes, dashboard notification routing/live notification center, and rolling conflict isolation/prevention.


## v1.6.34
- Rolling materializer now scans past the first 10 conflicted dates to find later free dates, preloads vehicle conflicts once, reports the conflicting schedule/rule IDs, and suppresses duplicate conflict warnings.


## v1.6.36
- Refined the global contact hub with opaque dark-mode surfaces, icon-only circular launcher, slimmer action bars, larger icons, and draggable saved positioning.

## v1.6.36
- Guest paid tickets now queue secure web/PDF ticket links to email and WhatsApp without requiring login.
- Added UGX per-ticket service-fee tiers and a UGX 3,000 full-route customer discount; intermediate stop fares are not discounted.
- Added privacy-aware Super Admin Visitor Monitoring.
- Consolidated public login/signup into one canonical account page and made WhatsApp support actions functional.
- Archive restore action is now icon-only and accessible.

## v1.6.37
- Fixed the login Tip spacing structurally with a guaranteed 18px layout gap.
- Replaced the Font Awesome Google glyph with a local four-color Google G mark while preserving the real `/auth/google` OAuth integration.
- Reworked visitor monitoring to batch MongoDB writes, use one faceted analytics query, cache the overview briefly, and rank slow pages.
- Made the Super Admin Monitoring page load a minimal dashboard snapshot and load analytics concurrently.
- Reduced notification-page dashboard hydration for Admin and Company roles to avoid unnecessary Atlas reads.

## v1.6.38
- Applied page-scoped cold-read plans across all dashboard roles instead of broad domain snapshots on routine navigation.
- Added shared shell-data stale-while-revalidate caching and compact Employee/Driver overview scopes.
- Added authenticated dashboard link prefetch/warmup while excluding prefetch traffic from visitor monitoring.
- Raised production dashboard read concurrency safely for the configured Mongo pool and increased the fresh dashboard snapshot window to three minutes.
- Confirmed paid tickets now send SMS automatically when the customer supplied a phone number, alongside email/WhatsApp where available.
- SMS ticket delivery uses a short secure ticket URL and generic booking delivery now leaves the request path through the encrypted outbox.
- Removed the obsolete paid SMS/WhatsApp ticket starter add-on because digital ticket delivery is now standard.


## v1.6.39
- Stabilized partner signup, server-side country/currency derivation, error reporting, form recovery, session fallback, and secondary provisioning resilience.
