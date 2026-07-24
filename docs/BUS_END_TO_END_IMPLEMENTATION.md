# Classic Trip Bus Module — End-to-End Architecture and Operations

**Implementation baseline:** July 22, 2026  
**Scope:** Bus marketplace only. The existing visual design, navigation, cards, modals, tables, buttons, spacing, typography, and responsive behavior are retained. Hotel code remains isolated for the next implementation stage.

## 1. Architecture boundary

The bus vertical is one bounded module inside the existing modular monolith:

```text
Existing EJS customer/company/employee/driver UI
        |
Existing web controllers and permission middleware
        |
Canonical Bus Module
  - setup service
  - departure service
  - inventory service
  - search service
  - booking service
  - operations service
        |
Repository boundary
        |
MongoDB canonical collections + compatibility projections
        |
Payment, ledger/settlement, notification, support and audit modules
```

The existing shared platform entities remain shared: `Company`, `CompanyBranch`, `CompanyEmployee`, `Listing`, `Booking`, `Passenger`, `Payment`, `InventoryHold`, support, finance, notification, audit and outbox records. The bus module does not create duplicate versions of them.

## 2. Canonical entity relationship

```text
Company
  ├── CompanyBranch / terminal
  ├── CompanyEmployee / driver
  └── Listing (serviceType = bus)
        ├── Route
        │     ├── RouteStop (ordered)
        │     ├── RouteSegment (consecutive stop pair)
        │     └── FareProduct
        │           └── BusSegmentFare
        └── Vehicle
              └── SeatMapTemplate
                    └── SeatMapVersion

TripSchedule (dated departure)
  ├── Route + immutable route snapshot
  ├── Vehicle
  ├── SeatMapVersion + immutable seat-map snapshot
  ├── FareProduct + immutable fare snapshot
  ├── DriverAssignment
  ├── Seat compatibility projection
  └── BusSeatSegmentInventory

Booking
  ├── BookingItem (one per outbound/return leg)
  │     └── BusReservation
  │           ├── BusSeatAssignment
  │           └── BusTicket
  ├── Passenger operational records
  ├── InventoryHold + InventoryHoldItem
  ├── Payment / refund / settlement records
  └── ticket-leg and booking-leg display projections
```

### Ownership rules

- Every provider-owned bus entity carries `companyId`.
- Every bus resource is resolved under the authenticated company before read or mutation.
- A route, vehicle, fare, driver, departure or ticket from another company is rejected even when its identifier is known.
- The frontend never supplies a trusted role, company, price, commission, availability or booking status.

## 3. Why the former model was unsafe

The old structure mixed reusable setup, dated inventory and transactions. It allowed or encouraged:

- route endpoints to be typed repeatedly;
- reusable seat templates to live inside vehicles;
- recurring schedules and actual dated departures to be treated alike;
- a single `basePrice` to act as the complete fare model;
- a seat to be locked for the entire route even when sold only for part of it;
- passenger, ticket, reservation and seat assignment records to remain embedded and difficult to audit;
- browser payment callbacks to be mistaken for trusted webhooks;
- return travel to reuse the outbound route incorrectly;
- one ticket scan to mark a multi-passenger or round-trip booking fully checked in.

The canonical module separates those responsibilities while keeping compatibility fields only where the current UI still reads them.

## 4. Bus setup workflow

### Step 1 — Company and terminal prerequisites

A company must exist and own active branches/terminals. The setup form selects terminal records; it does not accept arbitrary internal IDs.

### Step 2 — Public bus listing

The listing stores public marketplace information:

- title and description;
- primary operating terminal;
- public service image;
- public operations phone;
- operator licence reference;
- baggage policy;
- cancellation/change policy;
- amenities and sales channels;
- draft or publish request.

The listing does **not** own route stops, dated departures, seats or a manually typed trusted price.

### Step 3 — Vehicle and seat-map version

The vehicle stores:

- unique registration/fleet code;
- manufacturer/model details;
- capacity and layout;
- amenities and image;
- operator permit and expiry;
- inspection reference and expiry;
- insurance reference and expiry.

Creating a vehicle also creates:

1. `SeatMapTemplate` — the reusable identity of the map;
2. `SeatMapVersion` — an immutable published version with checksum;
3. a legacy `seatTemplate` projection used only by existing dashboard rendering.

Editing a seat map creates a new version. Existing departures keep their frozen old version.

### Step 4 — Route, ordered stops and segments

A route selects an existing origin terminal and destination terminal. Intermediate boarding/drop-off branches are selected from company-owned branches.

`RouteStop` records define order and pickup/drop-off permissions. The system then generates one `RouteSegment` for every consecutive stop pair.

Example:

```text
0 Kampala -> 1 Jinja -> 2 Busia -> 3 Kisumu

Segments:
0 Kampala/Jinja
1 Jinja/Busia
2 Busia/Kisumu
```

### Step 5 — Fare product and segment fares

A `FareProduct` owns:

- name and class;
- currency;
- booking fee;
- refundable/changeable flags;
- baggage allowance;
- policy references and sales window.

`BusSegmentFare` selects existing route stops. It supports either:

- an exact fare for any origin/destination pair; or
- a sum of consecutive segment fares.

A departure selects a fare product. It does not trust a price typed into the departure form.

### Step 6 — Dated departure

`TripSchedule` is an actual dated trip, not the reusable route. It freezes:

- route version and complete route snapshot;
- seat-map version and checksum;
- fare product and price/policy snapshot;
- vehicle;
- driver assignment;
- departure, arrival and boarding times;
- generated segment inventory.

A draft departure may remain without a driver. Publication requires all readiness and safety checks.

### Step 7 — Publication gate

A dated departure cannot publish unless:

- company is active and verified;
- listing and route are valid;
- ordered stops and route segments are complete;
- vehicle is active;
- vehicle permit is present and valid at departure time;
- inspection is present and valid at departure time;
- insurance is present and valid at departure time;
- a published seat-map version exists;
- an active fare product and positive fare snapshot exist;
- an active verified driver is assigned;
- departure is in the future and arrival follows it;
- seat-segment inventory was generated;
- the vehicle has no overlapping active departure.

A listing becomes public only after at least one safe dated departure is published and the listing itself has required media, contact and policy information.

## 5. One-step bus wizard transaction behavior

The existing bus-service wizard now creates one coherent chain:

```text
Draft Listing
 -> Vehicle + SeatMapTemplate + SeatMapVersion
 -> Route + endpoints + intermediate stops + segments
 -> FareProduct + initial full-route fare
 -> Dated departure + seat-segment inventory
 -> optional departure publication
 -> optional listing publication
```

The request uses an idempotency key. A repeated submission returns the original result and deletes newly uploaded replay media so duplicate services and orphan files are not created.

Because the legacy repository layer cannot wrap every compatibility write in one MongoDB transaction, a failed wizard uses compensating archive operations in reverse order. Nothing is left publicly bookable after a partial failure.

## 6. Search and return travel

Public search uses published dated departures. Results are created from canonical route, fare and inventory records.

A return search looks for a real reverse route whose ordered stops contain:

```text
outbound destination -> outbound origin
```

The return leg has its own departure, route, vehicle, seat-map version, fare, inventory hold, reservation and tickets. It is not another copy of the outbound schedule.

## 7. Seat availability and route-segment inventory

For every dated departure, the system creates one row for each enabled seat on each route segment.

```text
48 seats x 5 route segments = 240 inventory rows
```

A seat is available for a requested journey only when every required segment row is available.

This allows safe partial-route sales:

- Passenger A: Kampala -> Busia, seat 4;
- Passenger B: Busia -> Kisumu, seat 4;
- both may coexist because their segment ranges do not overlap.

The compatibility `Seat` record remains a dashboard projection. `BusSeatSegmentInventory` is authoritative.

## 8. Seat-hold security

Creating a hold:

1. verifies the departure is published and future;
2. resolves selected route stops and required segments;
3. calculates fare server-side;
4. validates each selected seat across every required segment;
5. rechecks inside the transaction;
6. writes `InventoryHold`, `InventoryHoldItem` and held inventory rows;
7. relies on the unique active resource key as a second concurrency defense;
8. returns a random access token once.

Security rules:

- only the SHA-256 token hash is stored;
- comparisons use `crypto.timingSafeEqual`;
- hold creation/release uses a protected header or request body, never a URL query;
- the transition to checkout validates the hold and stores AES-GCM-encrypted access only in the server session;
- the checkout URL contains only an opaque session-bound draft identifier;
- checkout HTML and form fields do not expose the raw hold token;
- final booking creation requires the hold ID and access token, but the token is restored from the trusted server session rather than submitted by the browser form;
- expired/abandoned holds release inventory;
- internal consumption methods never expose the token.

## 9. Booking and checkout

Before the unchanged checkout UI opens, the browser sends the hold credentials to a CSRF-protected preparation endpoint. The backend validates the outbound and optional return hold, stores a short-lived draft with AES-GCM-encrypted hold access in the server session and redirects with only an opaque draft ID. The checkout response is non-cacheable, contains hold IDs for traceability, and contains no raw hold tokens. On final submission the backend restores all authoritative leg, stop, seat and token values from the draft.

The booking form preserves the existing UI but now collects and submits canonical data:

- outbound hold ID, with its access token retained in the server session;
- optional return hold ID, with its access token retained in the server session;
- selected boarding/drop-off stops;
- one selected seat per passenger and per leg;
- full passenger name;
- phone/email contact;
- identity type and number;
- date of birth, sex and nationality where required;
- emergency contact;
- luggage count;
- special/travel notes.

The server creates:

- one shared `Booking`;
- one `Passenger` record per traveler;
- one `BookingItem` per leg;
- one `BusReservation` per leg;
- one `BusSeatAssignment` per passenger per leg;
- one `BusTicket` per passenger per leg;
- immutable price, policy and route snapshots;
- pending ticket-leg display projections.

The browser cannot submit an authoritative total. The total is recalculated from fare and seat-map snapshots.

## 10. Payment lifecycle

```text
Awaiting payment
 -> provider checkout
 -> signed webhook / independently verified Pesapal status
 -> amount and currency verification
 -> idempotency claim
 -> payment record
 -> consume exact held segments
 -> confirm booking items and reservations
 -> activate tickets
 -> settlement/commission workflow
 -> notifications and audit/outbox events
```

A browser return URL is never trusted as proof of payment. Only Pesapal returns containing a tracking ID may trigger an independent server-to-server status query. Other providers must confirm through the signed webhook endpoint.

Failure and refund behavior:

- failed payment cancels canonical reservations and releases inventory;
- a pre-departure cancellation releases all unused segments;
- a provider-confirmed refund updates booking, items, reservations, assignments and tickets;
- money operations are idempotent;
- payment amount and currency must match the stored booking snapshot;
- uncertain payments stay pending/reconciliation-required rather than being reported successful.

## 11. Ticket, QR, manifest and daily work

Each ticket belongs to exactly one passenger, seat assignment, reservation, booking item and dated departure.

Ticket validation checks:

- token/ticket existence;
- company ownership;
- expected departure;
- payment success;
- booking/reservation state;
- seat assignment;
- ticket validity and prior use;
- operator membership/permission.

The passenger manifest is generated from canonical tickets, passengers, reservations and assignments. It is not manually re-entered.

For multi-passenger or round-trip bookings:

- scanning one ticket updates only that ticket/assignment;
- the whole booking becomes `partial` until all required tickets are checked in;
- earnings are released only after the booking reaches its complete required check-in state;
- no-show is recorded per ticket and seat assignment.

## 12. Authorization and tenant isolation

### Traveler/public

- rate-limited public read/write endpoints;
- hold token required for hold-scoped access;
- ticket pages require authorized account, exact contact/access code or granted session;
- public identifiers do not authorize provider operations.

### Company staff

- active company membership required;
- company ID is derived from the authenticated session;
- entity ownership is rechecked in services/repositories;
- scoped listing/schedule permissions remain enforced;
- drivers can operate only assigned departures;
- company administrators may perform company-wide operations explicitly allowed by policy.

### Platform administrators

- existing permission middleware remains authoritative;
- sensitive actions are audited;
- provider records are never trusted from browser-hidden controls.

## 13. Security controls applied

- fail-closed MongoDB production repository behavior;
- CSRF protection for browser mutations;
- strict request size limits and rate limiting;
- server-side validation and sanitization;
- tenant-filtered repositories;
- immutable snapshots for route, seat map, fare and policy history;
- idempotent setup, booking, payment, refund and webhook processing;
- signed webhooks and provider verification;
- exact amount/currency checks;
- constant-time hold-token comparison;
- hashed ticket QR tokens;
- upload MIME/signature/size validation and cleanup;
- CSP nonces, Helmet and HTTPS production redirect;
- audit and transactional outbox events;
- no hard deletion of financial or fulfilled booking records;
- publication gates for driver and vehicle compliance;
- concurrency-safe seat-segment claims.

No codebase can honestly be guaranteed permanently vulnerability-proof. Production still requires current dependency scanning, penetration testing, secure infrastructure, monitored secrets, backup restoration tests and payment-provider certification.

## 14. Compatibility and cleanup rules

Compatibility projections are retained only where the existing UI or old records still require them:

- `Vehicle.seatTemplate` mirrors the active `SeatMapVersion`;
- `Seat` summarizes segment inventory for existing seat dashboards;
- `Booking.bookingItems`, `bookingLegs` and `ticketLegs` summarize normalized records for current templates.

New business decisions are made only from canonical records. No second bus listing, route, schedule, booking, payment or manifest system was created.

## 15. Existing-data migration

The migration is idempotent and dry-run by default:

```bash
npm run migrate:canonical-transport
npm run migrate:canonical-transport:apply
```

It converts:

- embedded/legacy route stops into ordered stops and segments;
- vehicle seat projections into templates and versioned seat maps;
- legacy route/schedule prices into explicit fare products and fares;
- dated schedules into frozen route/seat-map/fare snapshots;
- schedule seats into segment-level inventory;
- legacy active bus bookings into normalized items, reservations, assignments, tickets and historical holds.

Unsafe legacy departures are forced to draft when driver, fare, permit, inspection or insurance requirements are not met. Apply mode fails with a reconciliation report when active records cannot be converted safely.

After backup and successful reconciliation, legacy embedded route fields may be removed:

```bash
npm run migrate:canonical-transport:archive
```

## 16. Verification commands

Dependency-free gates:

```bash
npm run check
npm run verify:bus
npm run check:architecture-security
npm run check:routes
npm run check:entity-relations
npm run check:dashboards
npm run check:dashboard-smoke-static
npm run acceptance:matrix
```

After installing locked dependencies and starting a MongoDB replica set:

```bash
npm ci
npm test
npm audit --omit=dev
npm run launch:check
```

## 17. Completion definition

The bus vertical is considered implemented end to end because its existing UI now connects to canonical setup, dated inventory, search, holds, round trips, checkout, payment, tickets, manifest, check-in/no-show, cancellation/refund, settlement integration, authorization, audit, migration and automated release gates.

Hotel remains the next bounded vertical and must reuse shared identity, company, listing, booking, payment, finance, support, notification and audit entities without copying the bus-specific route/seat model.
## 18. Fresh installation and test seed

A fresh database no longer starts with the old embedded bus structure. The seed creates the same canonical boundaries used by migrated production data:

- one active route with ordered stops and route segments per bus listing;
- one compliant vehicle with an active template and published seat-map version;
- one active fare product with exact and adjacent segment fares;
- published dated departures with immutable route, seat-map and fare snapshots;
- an active verified driver assignment;
- one seat-segment inventory row for every departure × enabled seat × route segment;
- normalized sample booking items, reservations, seat assignments and tickets;
- consumed inventory holds/items and matching booked or checked-in inventory;
- processed outbox events for historical sample confirmations.

`npm run verify:bus` validates these fresh-seed relationships as part of its dependency-free gate.

