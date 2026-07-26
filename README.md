# Classic Trip — Bus, Stays & Homes, Flight Agents and Safe Local Mobility

Production-oriented Node.js, Express and MongoDB marketplace for **bus travel, verified stays and homes, flights plus simple platform-dispatched boda and car rides**. The operational service registry exposes `bus`, `hotel`, `flight` and `local_transport`; unfinished future categories remain explicitly non-bookable.

The existing visual design is preserved across public pages, authentication, partner dashboards, employee dashboards and operational documents. Shared components, spacing, forms, tables, tabs and action patterns are reused rather than duplicated.


## Stays and Airbnb-style hosting

The public marketplace uses **Stays** as the customer-facing category. The internal service key remains `hotel` so existing routes, bookings, collections, payment records and reports remain compatible.

Supported inventory includes hotels, lodges, resorts, guest houses, serviced apartments, apartments, entire homes, private rooms, shared rooms, villas, cottages, cabins, bungalows, homestays, holiday homes, farm stays, bed-and-breakfast properties, hostels and camps.

Both verified accommodation businesses and individual `stay_host` accounts can onboard. Hosts can configure the rental mode, host identity, instant-book preference, maximum guests, bedrooms, bathrooms, kitchens, cleaning fees, refundable deposits, guest access and shared spaces. Classic Trip provides an Airbnb-style hosting model but is not integrated with or affiliated with Airbnb.

Public entry point: `/stays`. The aliases `stay`, `stays`, `home`, `homes` and `accommodation` resolve to the existing accommodation booking engine.


## Marketing-page responsiveness

Public marketing pages use a scoped responsive contract that preserves the approved design while preventing CTA, badge, card and footer overflow. Partner Commission, Partners, Services, How It Works, Promoters, Routes, Support, legal pages, blogs and public partner profiles share this contract.

Run the dedicated regression gate with:

```bash
npm run check:marketing-mobile
```

## Requirements

- Node.js 20+
- npm 10+
- MongoDB Atlas or a replica set with transactions enabled
- Cloudinary or another configured production media adapter
- At least one configured payment provider before accepting live payments
- Email/SMS/push credentials for real notification delivery
- A production road-routing service (OSRM, Valhalla, Mapbox-compatible adapter) and permitted map tile provider for Local Mobility

Production refuses transaction-sensitive flows when MongoDB transaction support is unavailable.

## Initial setup

```bash
cp .env.example .env
npm ci
npm run seed:superadmin
npm run verify
npm start
```

Use strong independent secrets for sessions, MFA encryption, payment webhooks and the Super Admin. Do not commit `.env`.



## Development, production and terminal output

Local development uses quiet nodemon automatically:

```bash
cp .env.example .env
npm ci
npm start
```

- `npm start` uses nodemon when `NODE_ENV` is not `production`.
- Changes to JavaScript, EJS, JSON and CSS restart the server automatically.
- Type `rs` in the terminal to restart manually.
- Do not install with `--omit=dev` on a development machine because nodemon is a development dependency.

The normal application output is intentionally limited to the database connection and listening address. Warnings and errors remain visible because they require action. Routine job-registration messages and slow-request warnings are disabled by default.

```text
✓ MongoDB connected — host=... db=classic-trip transactions=true
✓ Classic Trip listening — url=http://localhost:5000 port=5000 nodeEnv=development
```

Enable temporary performance diagnostics only when investigating a problem:

```env
LOG_LEVEL=info
LOG_SLOW_REQUESTS=true
SLOW_REQUEST_THRESHOLD_MS=1200
```

Production uses plain Node, not nodemon:

```bash
npm ci --omit=dev
npm run db:indexes
npm run doctor
NODE_ENV=production npm run launch:check
npm run start:prod
```

`npm run db:indexes` creates declared indexes without dropping application data. `npm run doctor` checks the selected database, Atlas/replica-set transaction support, connection pool, scheduled jobs and live routing configuration.

## Performance architecture

- The homepage reads only active, published records and live inventory for the four production services.
- Its read model is prewarmed, deduplicated and cached with stale-while-revalidate behaviour.
- Dashboard snapshots and role projections are cached briefly and invalidated automatically after writes.
- Successful login no longer waits for device/audit persistence after the secure session is saved.
- Login identity and lockout reads run concurrently and the lockout query has a matching compound index.
- MongoDB uses an explicit bounded connection pool.
- HTTP requests have bounded request and connection reuse limits.
- `X-Request-ID` and `Server-Timing` remain available for debugging without producing terminal noise by default.

## Final spacing, stacking and feedback completion

This release keeps the approved reference UI byte-for-byte and adds one narrowly scoped completion layer for issues found after the reference merge:

- smaller, consistent dashboard phone gutters aligned with the mobile menu;
- reliable grid gaps so dashboard, marketing and authentication cards cannot overlap;
- padded empty-listing and empty-table states;
- separated final cards and notices in authentication/onboarding panels;
- shared dismissible flash feedback on public, authentication, dashboard and standalone document pages;
- secure logout and password-reset success feedback after redirect;
- responsive containment for manifests, tickets, receipts and vouchers.

The completion layer does not redefine the approved global body, navigation, sidebar, card, button, colour or typography systems. Run `npm run check:spacing-flash-final` to verify this contract.

## Approved reference UI contract

This release uses the UI from the user-provided reference archive as the visual source of truth. The six core stylesheets are hash-locked and must not be replaced by global polish or override files.

- Public navigation, cards, banners, forms, search, booking and phone breakpoints come directly from the approved reference UI.
- Dashboard rail, topbar, cards, navigation, forms and mobile drawer come directly from the approved reference UI.
- Flight, Local Mobility, partner-directory, support and final Hotel/Bus operational elements use narrowly scoped additions only.
- No scoped addition may redefine `body`, the global container, the dashboard sidebar, the dashboard main shell or generic card/button geometry.
- The accessibility layer restores keyboard focus, reduced-motion and forced-colour support without changing dimensions, radii, colours or layout.
- Dynamic seat groups, checkout alignment, manifests and completed operation panels are added through feature-specific selectors rather than edits to the reference CSS.

Run `npm run check:reference-ui` to verify the exact reference hashes, absence of destructive global styles, scoped extension boundaries and all four active services.

## Runtime health and deployment lifecycle

- `GET /health` is the process liveness endpoint.
- `GET /ready` returns HTTP 200 only while MongoDB is connected; it returns HTTP 503 when the application is not ready to receive traffic.
- Every request receives a server-generated `X-Request-ID` for protected log correlation.
- SIGTERM/SIGINT perform graceful HTTP shutdown and MongoDB disconnect, with a bounded forced-exit timeout.

## Security and release position

No responsible engineering process can guarantee that any application is permanently “zero vulnerability.” This project is built to prevent known classes of defects, fail closed for sensitive operations, isolate tenants, protect booking access, use CSRF and rate-limit controls, keep money operations idempotent and require production verification before launch. A live release still requires dependency installation, vulnerability scanning, MongoDB transaction tests, payment/map/supplier sandbox tests, DAST and an independent penetration test.

## Real Local Mobility maps and routing

Local Mobility no longer uses a decorative route card. The customer booking and protected tracking pages use a real Leaflet map, backend road-routing geometry, stored route snapshots, current driver position, geofenced pickup validation and private lookup access.

Production configuration:

```env
MAP_TILE_URL=https://your-approved-tile-provider/{z}/{x}/{y}.png
MAP_TILE_ATTRIBUTION=Your map attribution
TAXI_ROUTING_API_URL=https://your-routing-service
TAXI_ROUTING_PROFILE=driving
TAXI_ROUTING_TIMEOUT_MS=8000
TAXI_REQUIRE_LIVE_ROUTING=true
```

The public demo OSRM endpoint in `.env.example` is suitable for development only. Production should use a contracted or self-hosted service with capacity, uptime and data-processing terms appropriate for customer location data. When `TAXI_REQUIRE_LIVE_ROUTING=true`, quote creation fails closed rather than silently charging from an estimated straight-line distance.

## Unified authentication and onboarding

There is one rendered authentication/onboarding page:

- Login
- Customer signup
- Promoter signup
- Intelligent service-aware partner onboarding for bus operators, hotels, flight agents, boda riders, car drivers and fleet/rental owners
- Password recovery
- Email verification
- Phone verification
- MFA screens when enabled

`GET /partner/onboarding` is only a compatibility redirect into the Partner panel on the shared page. `POST /partner/onboarding` remains the one secure partner/company provisioning service.

Role rules:

- Customers, promoters and new company owners may self-register.
- Company staff and drivers are invitation-only.
- Platform administrators are invitation-only and MFA-governed.
- Super Admin is created or updated only through the supported bootstrap command.
- Pending partners may enter a restricted onboarding workspace but cannot publish, operate live bookings, collect operational payments or request payouts until verified.


## Partner commission model

Partners do not purchase a platform package. Eligible bus operators, hotel operators, accredited flight agents, individual boda/car drivers and fleet or rental owners may create the appropriate account and enter the restricted verification workspace immediately.

The commercial flow is:

```text
Customer booking total
  -> service-specific immutable split calculated by the backend
  -> bus/hotel operator, verified flight agent or assigned mobility provider receives only its configured earning
  -> flight supplier payable remains separate from the agent commission
  -> mobility driver/fleet payout follows the Super Admin policy
  -> when a promoter referred the booking, the promoter reward comes from Classic Trip's commission
```

- The default percentage is managed in **Super Admin → Platform Settings**.
- Super Admin may set a partner-specific percentage from **Partners / Companies**.
- Bus and hotel companies accept their commission contract during onboarding; flight-agent and mobility earnings use their own approved policies.
- Every booking stores an immutable contract and split snapshot.
- Later percentage changes affect only new bookings.
- Verification, not a payment package, controls publishing, operational payments and payouts.
- There are no partner renewals, recurring charges or commercial feature tiers.

The fresh-install default is 10% commission. Promoters receive 30% of Classic Trip's commission on an eligible referral, producing the former 90% partner / 7% platform net / 3% promoter result without charging the partner twice. Super Admin can change both percentages.

## Complete dashboard service coverage

The Super Admin console and role dashboards expose all four production services and the correct partner models. Dashboard records are projections of the canonical MongoDB entities; no dashboard keeps an isolated copy of operational data.

Super Admin service and partner workspaces include:

- Bus Providers and Hotel Providers
- Flight Agents plus platform-owned airline, airport, supplier, route, seat-map, fare and departure controls
- Local Mobility supply, including platform ride classes, zones, fare rules and automatic dispatch
- Individual Boda Riders and Car Drivers
- Fleet and Rental Owners
- Mobility Companies
- Driver/rider identity, licence, background-check and safety-training verification
- Vehicle insurance, inspection, registration and operational-compliance review
- Live/scheduled dispatch monitoring, private tracking status and pickup-PIN safeguards
- Restricted mobility safety and incident records
- Payments, immutable splits, agent commission, supplier payable, mobility earnings, settlements and payouts

Dashboard intelligence is partner-specific:

- A boda rider sees **My Boda**, **My Rider Profile**, availability, assigned rides, safety, earnings and payouts. They do not receive team or fleet-management controls.
- An individual car driver sees **My Car**, **My Driver Profile** and the same individual-only operational flow.
- Fleet/rental owners and mobility companies retain staff, fleet and driver-management screens, but cannot change platform fares, zones or dispatch rules.
- Flight partners receive the travel-agent sales and support workspace, not airline-operation controls.
- Bus and hotel partners keep their existing complete service-specific workspaces.
- Employee and driver menus remain permission-scoped to their assigned service, company and work.

A dedicated release gate, `npm run check:dashboard-service-coverage`, verifies this menu, projection, rendering, form-contract and role-specific behaviour.

## Canonical bus architecture

```text
Company
  -> Branch / terminal
  -> Public bus listing
  -> Compliant vehicle
  -> Published versioned seat map
  -> Route
      -> Ordered stops
      -> Generated route segments
  -> Fare product
      -> Segment fares
  -> Dated departure
      -> Frozen route / seat-map / fare snapshots
      -> Verified operational driver assignment
      -> Seat-segment inventory
  -> Inventory hold
  -> Booking and booking item
  -> Bus reservation
  -> Passenger
  -> Seat assignment
  -> Ticket / QR
  -> Payment
  -> Manifest / check-in / no-show
  -> Cancellation / refund / settlement
```

A bus departure cannot be published unless linked records belong to the same company and listing and publication readiness passes. Driver assignment requires a real driver account, accepted invitation, active company membership, required verification/safety state and operational permissions. A job title or legacy permission label cannot substitute for a driver identity.

Seat availability is authoritative per seat and overlapping route segment. Return travel creates independent outbound and return reservations, inventory claims and tickets inside one customer booking.

## Canonical hotel architecture

```text
Company
  -> Public hotel listing
  -> Hotel property
  -> Room type
      -> Occupancy and bed rules
      -> Rate plan and cancellation policy
  -> Physical room unit
  -> Explicit dated room-night inventory
  -> Booking and booking item
  -> Hotel reservation
  -> Named hotel guests
  -> Room assignments
  -> Payment
  -> Operational voucher
  -> Arrival / check-in
  -> In-house stay
  -> Check-out
  -> Housekeeping task
  -> Settlement eligibility
  -> Cancellation / no-show / refund review
```

Hotel rules:

- One canonical property per company listing.
- Internal relationships use selectors; staff do not type foreign IDs.
- Room types define adult, child and infant limits.
- Every declared traveler must have a named guest record.
- Sellable room-night inventory must be deliberately configured; checkout never manufactures missing inventory.
- A physical room must be available and housekeeping-ready before sale.
- Pricing is recalculated server-side from room nights, hotel rate plans, occupancy surcharges, property taxes, service fees, add-ons and the partner commission contract.
- Only the completed `pay_now` flow is exposed. Security/incidental policies do not act as booking-payment deposits.
- Payment confirms the reservation but keeps settlement `pending_fulfillment`.
- Check-out creates housekeeping work and changes earnings to `eligible`; payment alone never settles a hotel stay.
- Hotel cancellation evaluates the immutable booked rate policy. Non-refundable, missing-policy or penalty-window cases go to finance review instead of receiving an unsafe automatic full refund.
- Hotel no-show is transactional: reservation, guests, assignments and booking items are updated, safe room nights are released and finance reconciliation is required.

## Hotel operations UI

The Partner/Employee dashboard uses the same shared design for:

- Properties
- Room types
- Rate plans
- Room units
- Room calendar and inventory
- Housekeeping
- Arrivals
- In-house guests
- Departures
- Manifests and history/no-shows
- Operational vouchers and PDF vouchers

Hotel manifests can cover one selected listing/property or the company’s complete hotel portfolio. They include guest identity masking, nationality, contact, emergency contact, occupancy, assigned rooms, payment, actual arrival/departure times, special requests and stay status.

## Canonical flight-agent architecture

```text
Super Admin / platform flight supply
  -> Approved airlines and certified supplier adapters
  -> Airports, routes, aircraft references and versioned seat maps
  -> Fare families, baggage, meals, add-ons and dated offers
  -> Verified travel agent account
      -> Search supplier inventory
      -> Prepare customer quote
      -> Capture traveler documents
      -> Sell and support the booking
  -> Backend reprice and signed offer validation
  -> Flight order and atomic seat claim
  -> Payment authorization
  -> Supplier/native confirmation
  -> E-ticket, ticket coupons and QR
  -> Agent-assisted changes, cancellation/refund and support
  -> Separate agent commission, supplier payable and platform fee
```

Flight rules:

- Flight partners are travel agents, not airline-company operators.
- Only Super Admin and certified supplier integrations manage airline references, aircraft, routes, departures, seat maps and live inventory.
- Agents can search, quote, create customer bookings, collect required traveler information, view only their own sales, deliver tickets and assist with changes or support.
- One-way and return search are supported; a return selection becomes one protected order and one payment.
- External inventory fails closed unless an active certified adapter implements the requested capability.
- Payment alone never confirms a flight; supplier/native confirmation and ticket issuance must succeed.
- Travel-document values are encrypted and masked in operational and public views.
- Seat claims use versioned database compare-and-set updates; failed or expired payments release held seats.
- Agent company, flight supplier and platform tenant are stored separately for authorization and settlement.
- Agent commission, supplier payable, platform fee and promoter reward are separate immutable ledger movements.

## Canonical SafeBoda-style local mobility architecture

```text
Super Admin / platform mobility control
  -> Ride classes
  -> Countries, cities, districts and service zones
  -> Upfront fare rules and safety policy
  -> Verification and dispatch policy
  -> Individual boda rider / car driver / fleet or rental owner
      -> Identity and compliance documents
      -> Approved vehicle or managed fleet
      -> Availability and current location
      -> Assigned rides only
      -> Ride-status updates, incidents and earnings
  -> Customer one-screen request
      -> Current, Home, Work, Airport or manual pickup
      -> Destination and optional stops
      -> Boda or car class
      -> Now or scheduled ride
  -> Backend quote and immutable fare snapshot
  -> Payment
  -> Atomic platform dispatch
  -> Driver and vehicle assignment
  -> Pickup PIN and private live tracking
  -> Completion telemetry
  -> Platform-calculated driver/fleet earning and settlement
```

Mobility rules:

- The customer flow stays simple: choose pickup, destination, ride class and time, then confirm the upfront fare.
- Super Admin controls vehicle classes, coverage, fares, surge limits, verification standards, safety rules and dispatch configuration.
- Individual riders/drivers and fleet owners cannot create platform zones, change customer prices, manually choose customer jobs or submit their own payout amount.
- Partners manage only their approved identity, staff where applicable, compliant vehicles, online availability, assigned rides, operational status, incidents and earnings.
- Signup fields change by service type: boda/car drivers provide licence and vehicle compliance data; fleet/rental owners provide business and fleet data; flight agents provide agency accreditation and ticketing credentials.
- Only approved drivers, compliant vehicles and fresh locations are eligible for dispatch.
- Driver offers expire; the first valid atomic acceptance wins and all competing offers are cancelled.
- The passenger pickup PIN is hashed; the raw PIN is shown only to the authorized customer.
- The accepted fare remains locked. Distance and waiting submitted by the driver are telemetry, not authority to add charges.
- Driver/fleet payout percentage is set by Super Admin; individual drivers default to their full provider share, while fleet policies remain configurable.
- Failed payment creates no booking earning, and completed rides are settled only to the verified assigned provider.

## Intelligent partner onboarding

The single onboarding page progressively renders only the fields required for the chosen account:

| Partner type | Required operational information | Access after approval |
|---|---|---|
| Bus operator | Legal company, operating licence, branches and contacts | Own bus setup and operations |
| Hotel operator | Legal property/business data, accommodation licence and contacts | Own hotel inventory and operations |
| Flight agent | Agency registration, accreditation/TIDS/IATA or approved supplier credentials, ticketing and support contacts | Search, quote, sell and support platform flight inventory |
| Boda rider | Identity, rider licence, expiry, background/safety review and motorcycle details | Availability, assigned rides and earnings |
| Car driver | Identity, driving licence, expiry, insurance and vehicle details | Availability, assigned rides and earnings |
| Fleet/rental owner | Business verification, fleet contact, vehicles, approved driver staff and payout account | Own fleet, drivers, assigned rides and earnings |

No onboarding form asks applicants to type internal database IDs. Related staff, vehicles and service records use filtered selectors.

## Flight and mobility reference setup

```bash
npm run seed:travel-reference:dry
npm run seed:travel-reference
npm run migrate:flight-taxi:dry
npm run migrate:flight-taxi
npm run check:flight-taxi
```

The reference seed adds major East African airports, common aircraft references and platform-owned mobility classes, coverage zones and fare rules. It does not grant partners control of platform pricing or flight inventory. Always back up production data and review the dry run before applying migrations.

## Payments and finance

- Prices and totals are never trusted from the browser.
- Provider callbacks/webhooks must be verified and idempotent.
- Booking status, payment status, fulfillment status and settlement status remain separate.
- Financial corrections use auditable refund/ledger workflows.
- Hotel payment success creates pending earnings; fulfillment controls eligibility.
- Payout requests and approvals remain separate from booking fulfillment.

## Security baseline

- CSRF protection, including multipart uploads
- Same-origin checks before multipart parsing
- Server-side authentication and authorization
- Tenant/company isolation
- Service-type and resource-ownership checks
- Permission-scoped employee operations
- Signed invitation lifecycle
- Rate limiting on sensitive routes
- Password hashing and bounded password input
- Session rotation and revocation
- Audit/timeline records for sensitive actions
- File validation, scanning adapter and private media workflow
- No raw payment secrets in application data
- Idempotency for booking, payment, refund and operational transitions

No software can honestly be guaranteed permanently vulnerability-proof. Production release still requires dependency-backed tests, current vulnerability scanning, provider sandbox certification, concurrency testing and penetration testing.

## Existing-database migration

Back up the database first. Run the commercial migration, then the hotel-domain migration, then the flight-agent/platform-mobility migration, followed by the country/currency integrity migration.

```bash
npm run migrate:commission-only:dry
npm run migrate:commission-only
npm run migrate:hotel-domain:dry
npm run migrate:hotel-domain
npm run migrate:flight-taxi:dry
npm run migrate:flight-taxi
npm run migrate:country-currency:dry
npm run migrate:country-currency
npm run seed:travel-reference:dry
npm run seed:travel-reference
```

The commission migration removes retired partner billing fields and collections, creates the applicable commercial contract for each partner and preserves previous effective splits. The hotel migration normalizes legacy hotel bookings and setup records, consolidates duplicate properties safely and rewires dependent room/rate/inventory/reservation records. The flight/mobility migration converts legacy flight companies into agent accounts, moves airline inventory and mobility configuration under platform governance, persists agent/provider/supplier attribution, archives partner-owned fare/zone controls and applies safe driver-payout defaults. The country/currency migration automatically repairs only partners without financial history; active financial mismatches are flagged for Super Admin review without rewriting historic money. Inspect every dry-run output before applying.

## Verification commands

```bash
npm run check
npm run check:platform-final
npm run check:platform-layout-admin
npm run check:runtime
npm run check:production
npm run check:flight-taxi
npm run check:bus
npm run check:bus-forms
npm run check:smart-bus-forms
npm run check:smart-publish
npm run check:driver-assignment
npm run check:driver-ui
npm run check:driver-materialization
npm run check:staff-driver
npm run check:partner-ownership
npm run check:architecture-security
npm run check:routes
npm run check:csrf
npm run check:entity-relations
npm run check:partner-registration
npm run check:commission-only
npm run check:dashboard-repository
npm run check:dashboards
npm run check:addons-return-seats
npm run check:stop-pricing-ui
npm run check:end-to-end-final
npm run check:bus-hotel-final
npm run check:bus-hotel-conclusion
npm run check:hotel-operations-final
npm run check:final-regression
npm test
```

`npm run verify` executes the complete installed-dependency release suite.

## Production release checklist

Before deployment:

```bash
npm ci
npm run verify
NODE_ENV=production npm run launch:check
```

Also verify:

- MongoDB transactions and restore-tested backups
- HTTPS and trusted proxy settings
- Correct public `APP_URL` and `SITE_URL`
- Cloudinary/media credentials
- Payment provider callbacks and webhook signatures
- Email/SMS/push delivery
- Scheduled jobs enabled in exactly one worker/process
- Super Admin MFA enabled when operationally ready
- Current `npm audit`/dependency review
- Real concurrent final-seat and final-room tests
- Payment failure, retry, refund and reconciliation tests
- Provider sandbox certification and penetration testing

## Final spacing and Super Admin repair

The public site, authentication/onboarding screens and all role dashboards load final shared spacing styles. The Super Admin Flight and Local Mobility dynamic sections use explicit nested EJS locals and are protected by an executable render smoke. When an Atlas connection string omits a database path, the application now selects `classic-trip` unless `MONGO_DB_NAME` explicitly overrides it.

## Final deep cleanup (26 July 2026)

The final cleanup preserves the approved reference UI while fixing Super Admin Partner Network overlap, phone dashboard gutters, focused-input feedback, auth errors, dark-mode contrast and slow login/dashboard reads. Optional dashboard cache settings:

```env
DASHBOARD_SNAPSHOT_TTL_MS=5000
DASHBOARD_SNAPSHOT_STALE_MS=30000
```

## Partner Network uniform page contract

The nine Super Admin Partner Network destinations use one scoped structure: a separate hero, a separate data card, a standard card header, a contained table area and a padded empty state. The layout is isolated from generic dashboard positioning so cards cannot overlap. Driver and vehicle review forms scroll inside their own data surface on narrow screens.

The temporary light-blue input focus treatment has been removed. Form controls keep the approved neutral focus appearance.


## Version 1.2.1 final mobile and install update

This release preserves the approved Classic Trip UI and adds the final phone navigation and install experience. The authoritative report is `FINAL_RELEASE_REPORT_2026-07-27.md`.

### Complete local setup

```bash
cp .env.example .env
npm ci
npm run db:indexes
npm run doctor
npm run verify
npm start
```

### Production start

```bash
npm ci --omit=dev
npm audit --omit=dev
npm run db:indexes
npm run doctor
NODE_ENV=production npm run launch:check
npm run start:prod
```

Use `MONGO_DB_NAME=classic-trip`. Configure real payment, email/SMS, object-storage, routing/GPS and certified flight-supplier credentials before launch.


## Mobile navigation and installable app

- The phone/tablet bottom navigation hides while the user scrolls or types and returns after scrolling stops.
- Opening the Profile drawer hides the bottom navigation and reserves safe bottom spacing so the final menu action remains visible.
- The public Start action opens the Sign in page.
- The top Tickets action is hidden on phone navigation while ticket access remains available in the bottom navigation and drawer.
- Login, Signup and Partner remain in one clean three-column row on phones.
- KPI/stat cards remain two per row on phones.
- Blue and primary button labels keep readable colours on hover, focus and active states.
- Classic Trip is installable on supported phones and computers. The install prompt uses the full logo, product name and slogan.
- Installed launches receive a short, session-only branded splash without delaying normal browser visits.
- The service worker caches only static assets; account, payment, booking and dashboard HTML are never cached.

Verify this contract with:

```bash
npm run check:mobile-pwa
```

## Mobile button and statistics guarantee

- Blue button text stays visible during hover, focus, active and visited states.
- Phone statistic groups use two equal columns, including dashboard, finance, hotel, manifest, flight and local-mobility summaries.
- Verify with `npm run check:mobile-button-stats`.

## Installed-app orientation

The installed PWA is locked to portrait-primary on supported browsers so it does not rotate unexpectedly during launch or use. Browsers that do not expose the Screen Orientation API fall back to the manifest and the phone's system rotation setting.
