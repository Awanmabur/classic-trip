## v1.6.63

- Rebuilt anonymous Home/Search discovery around a lightweight marketplace snapshot that excludes booking-only seat rows, vehicles, room units and room-night inventory.
- Added gzip-compressed Redis sharing for public discovery so fresh Render processes can reuse the last known-good public index instead of making the first visitor rebuild it.
- Added stale-while-revalidate discovery behavior: once a valid public snapshot exists, anonymous requests are served immediately while Atlas refreshes in the background.
- Reused immutable departure route/fare snapshots and queries only route/fare records that are not covered by current departures.
- Cached enriched catalog cards per discovery snapshot to stop repeated route/fare recomputation on every search query.
- Home now enriches each listing once rather than repeatedly rebuilding listings while deriving companies and routes.
- Bus listing previews reuse the lightweight discovery snapshot while live selected-departure seat/fare APIs remain authoritative.
- Routes, Companies, Company Profile and Promoters now use the lightweight public discovery snapshot instead of the full operational inventory snapshot.
- WordPress/PHP scanner probes such as `/xmlrpc.php` are rejected before sessions, monitoring and CSRF middleware.
- Added dedicated v1.6.63 public-performance regression checks and production cache settings.

## v1.6.62

- Increased the two desktop bar image badges.
- Increased and widened the desktop bar departure/availability count badge while keeping title clearance.
- Preserved card badge sizing and compact phone bar sizing.
- Browser/service-worker assets bumped to v1.6.62.

# v1.6.60 — Slight badge increase

- Increased the two image badges slightly on marketplace cards and bars.
- Increased the inventory/departure-count badge slightly.
- Mobile badges remain proportionally compact.
- No route, amenity, price, card-height, preview, backend, or database behavior changed.

# v1.6.59 — Price hierarchy and badge sizing

- Reduced only `From`, the currency code, and the `Cheapest route fare` hint.
- Increased numeric fare weight slightly.
- Increased the two image badges and the availability/departure badge slightly.
- No functional or database changes.

# v1.6.58 — Card badge and lower-content visibility repair

- Reduced both image badges on marketplace cards/bars.
- Reduced and lifted the bar availability/departure badge so route lanes remain clear.
- Removed preview-image overlay text.
- Repaired the equal-height card layout so amenities, From/currency/amount, Cheapest route fare and buttons remain fully visible.

# v1.6.57 — Price/actions restored + amenity flow

- Restores readable `From UGX amount` pricing and `Cheapest route fare`.
- Keeps View/Book buttons visible on cards and bars.
- Amenities now flow in two independent swipeable lanes like routes, without squeezing or ellipsis.
- Keeps the v1.6.56 two-route-line card/bar rhythm and equal-height behavior.

# v1.6.56 — Marketplace card/bar rhythm

Two route rows, two amenity rows, no descriptions, lighter route typography, smaller From/currency labels, and natural equal-height cards/bars across marketplace pages. Bar images now fill the content-defined row instead of increasing its height.

# v1.6.55 — Dashboard state, archives and public departures

- Dashboard create/edit/delete/archive/publish actions now return to the exact dashboard page that initiated the action instead of jumping to another section.
- Successful dashboard mutations invalidate dashboard and marketplace caches immediately so counts, badges and public preview do not show stale values after a write.
- Archived operational records no longer reserve live uniqueness for replacement Hotel/Stay, Taxi, Flight, Bus fare and seat-template records. Existing databases can be reconciled with `npm run repair:archive-uniqueness`.
- Bus listing badges, dashboard listing counts and public preview now use the same future public departure set (`published`, `boarding`, `delayed`). Seat availability is no longer displayed as if it were a departure count.
- Creating a departure with Published intent is strict: it either passes publication readiness and becomes Published, or no Published-intent batch is silently saved as Draft. The operator stays on the same page and sees the exact readiness blockers.
- Added **Publish ready drafts** for existing future Draft departures after compliance/seat-map/fare requirements are corrected. Draft departures remain private until publication succeeds.
- Rolling Published creation performs a publication preflight before creating the recurring rule, preventing a clearly unpublishable rolling window from being silently materialized as Draft.

# v1.6.53 — Marketplace Cards & Dashboard Actions

- Removed repeated operator/route text from bus cards.
- Bus routes now use three swipe rows on cards and two on homepage bars with larger text.
- Bus card prices now show **From** using the cheapest full-route customer fare.
- Search and service landing pages reuse the approved service-specific homepage card identities.
- Blog directory is four cards per desktop row without modifying the approved homepage stylesheet.
- Company Quick Actions now open the real operational pages and their full Create forms.
- Departure archive actions are lifecycle-aware and safely support published/delayed departures with no passenger activity.
- Fixed the production `appUrl is not defined` startup crash and current-cookie notification CSRF handling.

# Classic Trip v1.6.53 — Seed Media Repair + Free Edit Selectors

## Fixed

- Known launch-seed external image URLs from the existing database are no longer classified as custom media. The seven seeded blog URLs and six seeded bus/operator URLs reported by `doctor:media:db` are recognized as legacy seed values.
- Public blog and seeded bus rendering immediately replaces those known hotlinks with stable same-origin `/media/blog/...` and `/media/operator/...` images.
- `migrate:seeded-media` uploads those known seed images to Cloudinary when configured, while preserving genuinely custom partner/admin media.
- `seed:launch-content` checks canonical seed IDs before semantic queries and handles duplicate-key races, preventing the Zawadi seeded-route `E11000` crash from aborting the seed.
- Edit relationship selectors are no longer disabled. They stay selectable like Create forms.
- Bus Route, Vehicle and Fare Plan reassignments are persisted after company ownership and live-dependency validation. Related draft/paused operational records are moved safely; live/in-progress dependencies block unsafe moves with a clear error.
- Stay Property, Room Type, Room Unit, Rate Plan and Room-night parent selections now persist validated relationship changes.
- Seat Template keeps Vehicle visible/selectable.
- Asset/cache version bumped to 1.6.53.

## Existing database repair

```bash
npm run seed:launch-content
npm run migrate:seeded-media:dry
npm run migrate:seeded-media
npm run doctor:media:db
```

After migration, the known seeded blog/bus rows should report Cloudinary URLs rather than `external-https`.

## Validation

- v1.6.53 media + selectable edit repair: 18/18
- v1.6.51 media/Cloudinary/PDFKit regression: 18/18
- v1.6.50+ selectable edit parity: 21/21
- v1.6.49+ edit/activation: 22/22
- v1.6.47 rolling/blog regression: 19/19
- blog-image regression: 8/8
- homepage/bus/departure regression: 16/16
- JavaScript syntax: 640/640
- EJS syntax: 131/131
- dashboard completeness: 52/52
- dashboard service coverage: 68/68
- Bus form contracts: 45/45
- Staff/Driver workflow: 51/51
- Partner ownership: 19/19
- Hotel operations: 27/27
- system completion: 162/162
- production readiness: 76/76
- final regression: 42/42
- lockfile integrity: 17/17
- release consistency: 11/11
- route security/CSRF/architecture checks passed

---

# Classic Trip v1.6.53 — Seed Media Repair + Selectable Edit Relationships

## Fixed

- Fixed seeded blog and bus listing images that remained broken because older external launch-seed URLs were incorrectly treated as user custom media.
- `migrate:seeded-media` now migrates those known legacy seed URLs to Cloudinary while continuing to preserve genuinely custom replacements.
- Public blog and operator/listing rendering replaces known seed hotlinks with same-origin `/media/blog/...` and `/media/operator/...` fallbacks immediately.
- Fixed `seed:launch-content` duplicate-key failure on canonical seeded route IDs by checking canonical IDs before loose semantic matches and recovering safely from a concurrent duplicate insert.
- Removed Edit-form relationship locking. Relationship selects are free like Create forms, while backend services enforce ownership and dependency safety on submission.
- Added validated reassignment support for Bus Route listing, Vehicle listing, Fare route, and Stay Property/Room Type/Rate Plan/Room Unit/Room-night parent relationships.

## Verification

- v1.6.53 media/edit repair: 18/18
- selectable edit-form parity: 21/21
- Bus form contracts: 45/45
- Hotel operations: 27/27
- Staff/Driver workflow: 51/51
- Dashboard completeness: 52/52
- Dashboard service coverage: 68/68
- Partner ownership: 19/19
- Production readiness: 76/76
- Final regression: 42/42
- Multipart CSRF: 44/44; browser CSRF: 4/4
- JavaScript syntax: 616/616
- Lockfile integrity: 17/17

---

# Classic Trip v1.6.51 — Unified Media + Cloudinary + PDFKit Cleanup

## Fixed

- Replaced the old PDFKit dependency tree that installed deprecated `jpeg-exif@1.1.4` with PDFKit `^0.19.1`; `jpeg-exif` and the old PDFKit-only `crypto-js` dependency are absent from the v1.6.51 lockfile.
- Centralized image URL resolution. `secureUrl` is preferred, then a valid `url`, then stable local media fallback.
- Seeded blog covers are served through `/media/blog/:slug` and six seeded bus/operator images through `/media/operator/:key`, so they can render even when Cloudinary is not configured.
- Public bus/stay/general listing cards and detail pages, company logos/covers, marketplace projections, saved listings and homepage cards use the shared media resolution path.
- Blog Create/Edit supports real file upload to Cloudinary via the validated upload service.
- Added non-destructive seeded-media Cloudinary migration and a media doctor command.
- Service-worker cache/version bumped to v1.6.51.

## Commands

```bash
npm run check:v1651-media-cloudinary-pdfkit
npm run doctor:media
npm run doctor:media:db
npm run seed:launch-content
npm run migrate:seeded-media:dry
npm run migrate:seeded-media
```

`migrate:seeded-media` requires `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`. Without them, seeded launch images still use the bundled same-origin `/media/...` fallback.

## Validation completed in the release workspace

- v1.6.51 media/Cloudinary/PDFKit: 18/18
- v1.6.50 Create/Edit parity: 21/21
- v1.6.49 edit/activation: 22/22
- v1.6.45 blog images: 8/8
- v1.6.44 homepage/blog/bus/departures: 16/16
- v1.6.43 blog/partner accounts: 13/13
- lockfile integrity: 17/17
- final release consistency: 11/11
- dashboard completeness: 52/52
- Bus form contracts: 45/45
- production readiness: 76/76
- JavaScript syntax: 638/638
- EJS syntax: 131/131
- route security, multipart/browser CSRF and architecture/security checks passed.

---

# Classic Trip v1.6.50 — Create/Edit Field Parity

## Fixed

- Route Edit now displays the Bus listing selected during Create.
- Vehicle Edit displays its service listing; Seat Template displays the selected vehicle.
- Stay Property Edit displays its Stay listing.
- Room Type Edit displays its Stay listing and Property.
- Rate Plan Edit displays its Room Type.
- Room Unit Edit displays its Room Type.
- Room-night Edit displays Room Type, Room Unit, Rate Plan and inventory date context.
- Fare Plan Edit displays its Route.
- Existing inactive or legacy saved selections remain visible.
- Unsafe parent moves remain blocked by backend ownership/integrity rules; immutable relationships are visible but locked.

## Verification

- `npm run check:v1650-edit-form-parity` — 21/21.
- `npm run check:v1649-edit-activation-integrity` — 22/22.
- `npm run check:bus-forms` — 45/45.
- Dashboard completeness — 52/52.
- Dashboard service coverage — 68/68.
- Staff/Driver workflow — 51/51.
- Hotel operations — 27/27.
- Production readiness — 76/76.
- Final regression — 42/42.
- JavaScript syntax — 633/633.
- EJS syntax — 131/131.

---

# Classic Trip v1.6.49 — Full Edit fidelity and Bus activation repair

This release fixes the create/edit drift reported in Bus Setup and extends the correction across company dashboard relationship fields. Bus listing Edit exposes every activation-critical field; Route Edit now restores and persists additional boarding/drop-off terminal selections; Vehicle Edit carries the creation-time seat layout into a safe versioned update; Staff/Driver edits preserve saved and invitation-pending branch/listing/schedule/permission selections; and Staff shift/notes now survive invitation acceptance.

Legacy departure repair is explicit and safe. `npm run repair:bus-launch-readiness` repairs missing seat-map links/live seat-segment inventory only where passenger activity does not make the departure immutable. Legacy future `active` departures are published only after full validation; draft departures remain draft. The script never invents operator licence references, baggage policies, cancellation policies, branch status or other compliance data.

Security invariants remain unchanged: company ownership is enforced server-side, passenger-active departure snapshots are never automatically relinked, CSRF-protected operational POST routes remain required, a physical vehicle still cannot be double-booked, and removed route stops are archived rather than silently reassigned.

# Classic Trip v1.6.48 — Runtime isolation and Atlas protection

This release isolates request serving from background maintenance, serializes worker jobs, caps worker MongoDB usage, bounds commission and rolling-repair batches, prevents fake timeout cancellation, and keeps the web process online when a worker fails. Blog media and rolling-rule repairs from v1.6.47 remain included.

## v1.6.61
- Clean bus checkout URLs: internal booking draft UUID moved out of the visible query string and into server-session active draft state.
- Legacy `?draft=` checkout URLs self-clean after validation.
- One more small marketplace image/count badge increase with mobile bounds preserved.
- Browser/service-worker assets bumped to v1.6.61.

## v1.6.64 — Redis runtime recovery + restored network tooling

- Restores `npm run doctor:network` with MongoDB SRV/member TCP diagnostics and Redis DNS/TCP/PING checks.
- Restores `npm run redis:local` to create/start `classic-trip-redis` on loopback-only `127.0.0.1:6379` and verify `PONG`.
- Redis startup remains bounded when it has never connected, preserving the existing MongoDB fallback behavior when Redis is optional.
- After Redis has connected once, transient runtime socket failures such as `ECONNRESET` now reconnect indefinitely using bounded exponential backoff plus jitter instead of permanently stopping after three attempts.
- Adds periodic Redis PINGs and explicit TCP keepalive to detect/recover dead idle sockets before they affect user requests.
- Redis connection-error and reconnect warnings are throttled to prevent log floods during a network flap.
- No dependency versions, database schema, seed data, booking rules, payment logic, v1.6.63 public-discovery performance work, or v1.6.62 bar badge sizing were changed.
