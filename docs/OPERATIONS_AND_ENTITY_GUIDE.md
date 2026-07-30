# Classic Trip operations and entity guide

This guide explains what each operational record represents, how records connect,
and the order in which they should be created. Dashboard forms use selectors for
internal relationships so users do not need to type database identifiers.

## Core ownership rule

Every partner-owned operational record belongs to one company. A company can
have branches, employees and one or more service listings. Records selected in a
form must belong to the signed-in company and, where applicable, the same
listing. A route, vehicle, fare, room, aircraft or driver from another company
cannot be attached accidentally.

## Bus entity relationship

The canonical bus chain is:

1. Company
2. Company branch or terminal
3. Bus listing
4. Route and ordered route stops
5. Route segments generated between consecutive stops
6. Vehicle
7. Published seat-map version attached to that vehicle
8. Fare product and stop-to-stop segment fares attached to the route
9. Optional saved company driver
10. Dated departure
11. Live seat-by-segment inventory generated for that departure
12. Booking, reservation, seat assignment and ticket

The listing is the public bus service. The route is reusable. The vehicle is a
physical asset. A seat-map version describes the stable layout of that vehicle.
A departure is the dated use of one route, vehicle, seat-map version and fare
product. Live availability belongs to the departure, not to the reusable
vehicle template.

The driver relationship is optional when a departure is created or published.
Any saved company driver record can be assigned. Account setup, company
membership status, licence, safety review, verification and permissions are
shown separately as operational-readiness warnings. They do not make a saved
driver disappear from the assignment selector.

If publishing fails a readiness check, the departure remains saved as Draft and
the dashboard states which checks remain. This prevents a successful inventory
creation from looking like a completely failed request.

An active recurring rule maintains today plus the next 29 calendar days. Rule
creation and resume queue the first month in the worker. The daily job adds one
new far-end day when the oldest day passes. Dates that pass readiness publish;
dates that do not pass remain Draft instead of being presented publicly as
usable inventory. Worker startup also runs one guarded reconciliation so an
existing usable departure does not wait until the next daily cron after a
deployment.

### Stop-dependent fares

Fare rows are defined by an origin stop and a later destination stop on the same
route. The price used by search and checkout is calculated for the selected stop
range. It is not a single route-wide amount. Consecutive segment fares can be
combined when a direct origin-to-destination fare row is not configured.

### Seat-map relationship

A vehicle owns seat-map templates and version history. Only a published version
can be selected by a live departure. The selected version is copied into the
departure snapshot so later edits do not silently rearrange seats already sold.
Seat layout rules, numbering direction, aisle side, per-row column pattern and
crew positions belong to that version.

## Hotel entity relationship

The canonical hotel chain is:

1. Company
2. Company branch
3. Hotel listing
4. Hotel property
5. Room type
6. Physical room unit
7. Rate plan and stay rules
8. Room-night inventory by date
9. Booking, hotel reservation, guest and room assignment
10. Housekeeping or maintenance task

Room types describe what a customer buys. Room units identify the actual rooms
operated by the property. Availability is stored by room type and night; room
assignment connects an accepted reservation to a physical unit.

## Flight entity relationship

Airline inventory is platform-governed. A flight agent company works through:

1. Agent company and employees
2. Airline or supplier
3. Aircraft and published aircraft seat-map version
4. Flight route
5. Fare family
6. Flight departure
7. Live seat inventory and offer
8. Agent quote or customer order
9. Traveler, seat assignment and ticket
10. Change or refund request

Agent-owned quote, order, change and refund records use the agent-company
relationship. They are not filtered as generic partner records.

## Taxi and mobility entity relationship

Mobility operations use:

1. Company and employees
2. Vehicle class
3. Taxi vehicle
4. Taxi driver profile linked to a saved company employee where applicable
5. Service zone and platform-governed fare rule
6. Driver availability and location
7. Ride quote and request
8. Ride assignment
9. Ride events, incident and driver earnings

The fleet, driver and availability pages load the company staff relationship
together, so an existing staff record can be selected without recreating it.

## Fields that must be selected

The following values represent relationships and must be selected from the
dashboard options:

- Company branch, origin terminal and destination terminal
- Listing or service
- Route, origin stop and destination stop
- Vehicle and seat-map version
- Fare product
- Saved company driver, when a driver is assigned
- Hotel property, room type and physical room unit
- Schedule or departure
- Booking, passenger, seat, guest or room
- Airline, aircraft, flight route, fare family and departure
- Taxi vehicle, driver profile, service zone and ride

If a selector is empty, first confirm that its parent record exists and is not
archived. For example, a departure requires an active route, active vehicle,
published seat map and active fare product for the same bus listing.

## Partner onboarding from beginning to completion

1. Register the partner company and finish company verification.
2. Add at least one branch or operational location.
3. Create employees and drivers. Driver accounts can finish acceptance and
   operational approval later.
4. Create a listing for the service being sold.
5. Complete the service-specific setup chain described above.
6. Create dated inventory: a departure, room-night inventory or mobility
   availability.
7. Resolve any Draft publication warnings and publish the service.
8. Confirm the public marketplace shows the live record.
9. Process bookings through manifest/check-in, support and finance workflows.

## Booking, support and finance relationship

A booking retains the selling listing plus provider, supplier or agent company
relationships when those roles apply. Service-specific reservations and
assignments remain attached to the booking. Support cases, correspondence,
reschedule requests, refunds and timeline events use the booking reference so
teams see one connected history. Payments, invoices, tax records, commissions,
settlements and wallet movements remain linked to that same commercial flow.

## Performance model

Dashboard pages request only the records required by the open page and read
independent collections concurrently. Short-lived snapshots are cached in
memory and Redis, with stale-while-revalidate behavior for fast navigation.
Login persists the session, starts the exact first-page dashboard prewarm, and
moves non-blocking audit work off the redirect path. Bulk bus and flight
inventory uses deterministic identifiers and batch writes rather than one
database counter operation per seat.

Production requires MongoDB and Redis. Run the database index task after a new
deployment so company, listing, route, vehicle, employee and fare selectors use
their compound indexes.

Scheduled work is isolated in the worker, uses a smaller MongoDB pool than the
web process and cannot overlap another run of the same job. The outbox drains
short batches, and known informational domain events are acknowledged once
instead of entering repeated failure retries.

## Archive lifecycle

Archive actions remove records from active dashboard and marketplace queries
immediately. The database retains archive-capable records for 30 days using
`archivedAt` and `purgeAfter`. A daily worker cleanup permanently removes an
expired archive only when no protected booking, ticket, reservation, payment or
other historical relationship still references it. Otherwise the record stays
hidden under a retention hold so financial and operational history remains
valid.
