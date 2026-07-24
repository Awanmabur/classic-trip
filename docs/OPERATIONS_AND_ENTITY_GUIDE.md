# Classic Trip Operations, Roles, Entities, and Workflow Guide

## 1. The simple rule behind the platform

Classic Trip separates records into four layers:

1. **Partner identity and approval** — who is allowed to operate.
2. **Reusable setup** — records created once and reused, such as branches, routes, vehicles, room types, and staff.
3. **Sellable inventory** — dated departures, seats, room nights, and prices customers can actually book.
4. **Operational and financial results** — bookings, passengers, tickets, manifests, check-ins, payments, commissions, support, refunds, and settlements.

A later layer must select records from the earlier layer. Staff should never type an internal database ID when the related record already exists.

---

## 2. Partner onboarding from beginning to completion

### Step 1 — Choose one primary service category

A company account has one primary category, such as Bus or Hotel. This keeps its permissions, dashboard, wallet, reports, inventory, and operational language isolated.

A business operating both buses and hotels should create two separately verified company accounts unless a future group-account feature is explicitly introduced.

### Step 2 — Enter company identity

The onboarding form captures:

- Trading or brand name
- Registered legal name
- Business registration number
- Tax or TIN number
- Primary service category
- Country and operating currency
- Head-office city and address
- Website
- Main contact name, email, phone, and WhatsApp
- Business description
- Subscription plan

The operating currency becomes the single currency for the company’s listings, schedules, bookings, wallet, commissions, and settlement records.

### Step 3 — Pay for the subscription plan

Classic Trip creates:

- A pending company record
- A pending company-admin account
- A subscription order
- A payment intent/payment record
- An onboarding support ticket
- An audit trail

Payment activates the subscription, but it does **not** automatically verify the company or publish services.

### Step 4 — Complete verification

The company uploads the relevant records:

- Business registration
- Tax certificate
- Operating licence or permit
- Payout account proof
- Company owner/representative identification where required
- Service-specific documents, such as vehicle registration, vehicle insurance, driver licence, hotel licence, or property verification

Super Admin reviews them. Until approval:

- The company remains pending.
- Publishing is blocked.
- Listings may stay in draft.
- Customer checkout is blocked.

### Step 5 — Configure reusable company records

Before creating sellable inventory, the company sets up:

- Branches, terminals, pickup points, drop-off points, offices, properties, or front desks
- Company policies
- Staff and permissions
- Payout account
- Support contacts

### Step 6 — Configure service-specific inventory

Bus and Hotel use different dependency chains, described below.

### Step 7 — Publish and operate

Once verification and required dependencies are complete, the company activates the public listing and live inventory. Customer booking then creates all downstream records automatically.

---

# Part A — Bus / Coach Operations

## 3. Bus entity relationship

```text
Company
├── Branch / Terminal / Pickup / Drop-off records
├── Company policies
├── Employees and drivers
└── Bus Listing (public service customers see)
    ├── Route (reusable corridor)
    │   └── Route Stops (ordered physical stops)
    ├── Vehicle (physical bus)
    │   └── Vehicle Seat Template (reusable layout)
    └── Schedule / Departure
        ├── Selected Route
        ├── Selected Vehicle
        ├── Selected active Driver
        ├── Fare, dates, boarding information
        └── Schedule Seats (live dated inventory copied from the vehicle template)
            └── Booking
                ├── Passenger snapshot
                ├── Ticket leg and secure QR
                ├── Payment and receipt
                ├── Manifest row
                ├── Check-in / no-show event
                ├── Timeline and notifications
                ├── Wallet/commission/settlement records
                └── Support/refund/reschedule records when needed
```

## 4. What each bus feature means

### Bus Setup

**Purpose:** A guided shortcut for creating the minimum connected records needed to launch a bus service.

It creates or connects:

- Public Bus Listing
- Origin branch/terminal
- Destination branch/terminal
- Route
- Vehicle and seat template
- Optional selected driver
- First schedule/departure
- Live schedule-seat inventory

Use it for an initial service launch. Use the individual modules later to add more routes, vehicles, and departures.

### Bus Listings

**Purpose:** The public product customers discover and book.

A listing contains customer-facing information:

- Service title
- Company and primary branch
- Public origin/destination description
- Starting price
- Contact and pickup/drop-off instructions
- Images
- Policies and baggage information
- Draft/active/paused/archived state

A listing is **not** a route, vehicle, or departure. One listing may have several departures and can reuse routes/vehicles.

### Routes & Stops

**Purpose:** Define where a service travels.

A Route selects:

- One Bus Listing
- Origin branch/terminal
- Destination branch/terminal
- Additional boarding branches
- Additional drop-off branches
- Operating days
- Distance and expected duration
- Baggage/cancellation rules where route-specific

Route Stops are ordered points within that route. They select an existing branch when the stop is an operating location. A public display label can be added, but the relationship remains branch-based.

A route does not reserve seats and does not represent a dated departure.

### Buses / Vehicles

**Purpose:** Represent the company’s physical buses.

A vehicle contains:

- Selected Bus Listing or service scope
- Fleet name
- Registration/plate number
- Make/model/year
- Capacity
- Seat layout name
- Amenities
- Status
- Registration/insurance documents

The physical vehicle owns a reusable **seat template**. It does not own a customer’s live booking state.

### Seat Maps

There are two related but different seat concepts:

1. **Vehicle seat template** — reusable layout, such as 2x2 with seats 1–48.
2. **Schedule seat map** — live inventory for one departure, copied from the vehicle template when a schedule is created.

Only schedule seats can be held or booked. Their live states include available, held, reserved/booked, checked-in, no-show, blocked, maintenance, and disabled.

Changing a future vehicle template should not rewrite historical departure seats or old bookings.

### Schedules & Fares

**Purpose:** Create a dated and priced departure customers can book.

A schedule must select:

- Bus Listing
- Route belonging to that listing
- Vehicle belonging to that company/listing
- Active eligible driver belonging to that company
- Departure date/time
- Arrival date/time or duration
- Base fare and currency inherited from company
- Boarding/check-in window
- Status

When saved, the system creates schedule seats from the vehicle seat template. The schedule is the core link between setup and daily operations.

### Bus Daily Work

Daily operations use existing schedules rather than recreating setup. Typical tasks are:

- Open the day’s assigned departures
- Review the live seat map
- Review passenger manifest
- Record desk bookings and payment
- Scan tickets/check in passengers
- Mark no-shows
- Block or release operational seats
- Send delay/boarding notices
- Record trip status and incidents
- Create shift handover
- Export manifests and reports

### Bus Bookings

A booking must select:

- Public Bus Listing
- Departure Schedule under that listing
- Available schedule seat under that schedule
- Passenger/customer details
- Optional add-ons

The system calculates the authoritative fare and claims the seat transactionally. Staff should never type a route ID, schedule ID, or internal seat ID.

### Passenger Manifests

**Purpose:** Operational list generated from bookings for a selected schedule.

The manifest is not manually maintained. It groups booking passengers by schedule and shows:

- Booking reference
- Passenger name/contact
- Seat number
- Boarding/drop-off information
- Payment status
- Check-in/no-show status
- Promoter/source attribution where authorized
- Special notes

Filters select existing schedules, routes, vehicles, drivers, branches, promoters, and booking sources.

### Check-in and ticket validation

A ticket QR resolves to a ticket leg and booking. The validator checks:

- Exact ticket/QR token
- Company and schedule ownership
- Booking and payment eligibility
- Ticket state
- Existing scan/check-in state
- Staff permission

Successful check-in updates ticket, passenger, booking, schedule seat, manifest, timeline, audit, and notifications consistently.

---

# Part B — Hotel / Stay Operations

## 5. Hotel entity relationship

```text
Company
├── Branch / Front Desk / Office
├── Company policies and staff
└── Hotel Listing (public service customers see)
    └── Hotel Property (physical establishment)
        └── Room Type (sellable category)
            └── Room Unit (physical numbered room)
                └── Room Night Inventory (one unit on one date)
                    └── Hotel Booking
                        ├── Guest snapshot
                        ├── Stay and booking items
                        ├── Claimed room nights
                        ├── Ticket/stay access record
                        ├── Payment and receipt
                        ├── Arrival/departure/in-house manifest
                        ├── Check-in/check-out
                        ├── Housekeeping tasks
                        ├── Wallet/commission/settlement records
                        └── Support/refund records when needed
```

## 6. What each hotel feature means

### Hotel Listing

The customer-facing hotel product:

- Public title and description
- Primary front desk/branch
- Location, address, images, amenities
- Check-in/check-out times
- Starting price
- Customer policies
- Listing status

It is not the physical room inventory itself.

### Hotel Property

A physical establishment under one Hotel Listing. It contains:

- Property name
- Address/city/country/location
- Check-in and check-out rules
- Amenities
- Taxes/fees/policies
- Media and verification documents
- Status

### Room Type

A sellable category under one selected Property and Listing, such as Standard Queen or Deluxe Twin.

It contains:

- Name
- Bed type
- Capacity
- Base nightly price
- Amenities
- Policies/fees
- Status

### Room Unit

A physical room under one Room Type, such as Room 301.

It contains:

- Room number
- Floor/wing
- Physical availability state
- Housekeeping state
- Assigned housekeeping staff when applicable
- Maintenance notes

### Room-night inventory

A row representing one Room Unit on one date. This is the actual hotel inventory that is held and booked.

A room type with three units across two nights produces six room-night rows. A two-night booking must atomically claim the same unit for both nights.

### Hotel booking

A booking selects:

- Hotel Listing
- Room Type under that listing/property
- Check-in/check-out dates
- Number of rooms
- Optional preferred room units
- Lead guest and additional guests
- Special requests

The system selects available room units and claims all required room-night rows transactionally.

### Hotel daily work

- Review arrivals, departures, and in-house guests
- Check in and check out bookings
- Update room-unit housekeeping state
- Update date-specific room-night state
- Assign housekeeping tasks
- Record maintenance blocks
- Create walk-in bookings and record payment
- Handle guest support/refunds
- Export manifests and occupancy reports

Housekeeping changes a physical room state. Inventory changes for a specific date use a room-night record. These should not be confused.

---

# Part C — Roles and dashboard responsibilities

## 7. Super Admin

Controls platform-wide governance:

- Partner verification and suspension
- Service/listing approval and content governance
- Role administration
- Platform settings and finance rules
- Cross-company finance/reconciliation
- Security/audit review
- Future service release controls

Super Admin does not perform a company’s normal daily bus or hotel tasks.

## 8. Operations Admin

Handles platform operational escalations across companies:

- Booking operations
- Reschedules
- Ticket/manifest exceptions
- Service disruptions
- Operational reports

Manual booking forms select public listings and service-specific live inventory.

## 9. Finance Admin

Handles:

- Payment intents and payments
- Receipts/invoices
- Fees/taxes
- Wallet ledger
- Settlement batches
- Payout requests/batches
- Reconciliation
- Finance risk and refunds

Finance actions select existing transactions, payout requests, settlement batches, bookings, or owners rather than typing internal IDs.

## 10. Support Admin

Handles:

- Customer/company support tickets
- Booking correspondence
- Disputes and escalations
- Timeline review
- Reschedule/refund coordination

Support is linked to a selected existing booking when one exists; general support can have no booking.

## 11. Content Admin

Handles public content and marketplace presentation:

- Listing/content review
- Media quality
- Blogs/guides
- Promotions/campaign presentation
- Release readiness

Content Admin cannot operate finance, check-ins, or company inventory.

## 12. Company Admin

Owns one company and one primary service dashboard. Can manage:

- Company profile and verification uploads
- Branches/properties/terminals
- Policies
- Staff and permissions
- Listings
- Service setup and inventory
- Bookings and daily operations
- Support/reviews
- Company revenue and settlement

Every selected related record must belong to that same company.

## 13. Company Employee

Access is action-based, not title-only. Examples:

- Front desk/manual booking
- Check-in/scanner
- Manifest viewing
- Inventory/housekeeping
- Route management
- Finance/payment recording
- Support
- Reports

An employee sees only the company, branch, listing, schedule, or room scope granted by active membership and permissions.

## 14. Driver

Sees only assigned operational records:

- Assigned schedules
- Passenger manifest
- Ticket validation/check-in if permitted
- Trip status
- Delay updates
- Incidents
- Handover

A driver is selected from an active company employee membership with eligible driver permission and verification data.

## 15. Promoter / Agent

- Creates referral links for selected live listings
- Shares QR/referral cards
- Tracks clicks/conversions
- Records authorized offline cash sales where enabled
- Sees own commission/wallet/payout data
- Sees fraud/review state relevant to own sales

Promoters cannot select another company’s hidden inventory or self-refer without risk controls.

## 16. Customer

- Searches public listings
- Selects live schedule seats or hotel dates/room types
- Pays and receives tickets/receipts
- Sees only own bookings
- Selects an owned booking for review, support, refund, or reschedule
- Manages profile, notifications, wallet, and saved listings

Public ticket lookup is the exception where a typed booking reference is appropriate because the user may not be logged in.

---

# Part D — Field source rules

## 17. Fields that must be selected

| Field | Select from |
|---|---|
| Company for admin action | Verified/eligible companies |
| Listing | Active listing owned by the correct company |
| Branch/terminal/property desk | Active company branches |
| Route | Routes under selected listing/company |
| Route stop branch | Company branches compatible with the route |
| Vehicle | Active company vehicles compatible with listing |
| Driver | Active eligible company employee/driver |
| Schedule | Active schedule under selected listing |
| Seat | Available live schedule seats under selected schedule |
| Hotel property | Property under selected hotel listing |
| Room type | Room type under selected property/listing |
| Room unit | Unit under selected room type |
| Room night | Date-specific inventory under selected room unit |
| Booking in authenticated dashboard | Booking owned by the current user/company scope |
| Payout request | Existing approved payout requests |
| Settlement batch | Existing settlement batch |
| Staff assignment | Active employee in company scope |
| Promotion listing | Eligible live listing |

## 18. Fields that are legitimately typed

- Customer/passenger/guest names
- Email and phone
- Public title/description
- Branch/property address
- Registration, tax, licence, permit, or provider reference numbers
- Vehicle plate number
- Room unit number
- Price/fare entered by an authorized setup user
- Dates/times
- Notes, policies, incident descriptions, support messages
- Public booking reference in anonymous lookup/support flows

## 19. Fields generated automatically

- Internal IDs
- Slugs
- Booking reference
- Ticket number and QR token
- Payment intent IDs
- Receipt/invoice references
- Audit IDs
- Wallet transaction IDs
- Commission and settlement rows
- Manifest membership
- Timeline events
- Schedule-seat rows copied from vehicle template
- Room-night claim references
- Notification/outbox events

---

# Part E — Status and lifecycle guide

## 20. Company

`pending → verified/active → suspended or rejected`

## 21. Listing

`draft → active → paused → archived`

Only active, verified, bookable listings appear in customer checkout.

## 22. Route / vehicle / property / room type / room unit

`active → paused/maintenance where applicable → archived`

Archived setup records cannot be selected for new inventory.

## 23. Schedule

`draft → active/published → boarding → departed → arrived/completed`

Alternative outcomes: delayed, cancelled, archived.

## 24. Seat

`available → held → booked/reserved → checked_in`

Alternative operational states: no_show, blocked, maintenance, disabled, released.

## 25. Hotel room-night

`available → held/reserved → booked → occupied → released/available`

Alternative states: cleaning, maintenance, blocked, cancelled.

## 26. Booking

Common path:

`pending_payment → confirmed/ticketed → checked_in → completed/checked_out`

Alternative path: cancelled, no_show, refund_pending, refunded, reconciliation_required.

## 27. Payment and settlement

`created/pending → successful → settled/released`

Alternative path: failed, reversed, refund_pending, refunded, reconciliation_required.

---

# Part F — Readiness checklists

## 28. Bus go-live checklist

- Company subscription active
- Company verified
- Payout details complete
- At least origin and destination branches/terminals active
- Customer policies complete
- Bus Listing active
- Route connected to listing and selected branches
- Vehicle active with valid capacity and seat template
- Driver active and eligible
- Schedule connected to listing, route, vehicle, and driver
- Schedule seats generated
- Fare, boarding time, and cancellation rules reviewed
- Test booking, payment, QR, manifest, and check-in completed

## 29. Hotel go-live checklist

- Company subscription active
- Company verified
- Payout details complete
- Front desk/branch active
- Hotel policies complete
- Hotel Listing active
- Physical Property connected to listing
- Room Types connected to property/listing
- Room Units connected to room types
- Room-night inventory generated for bookable dates
- Prices and stay rules reviewed
- Test booking, payment, arrival manifest, check-in, housekeeping, and check-out completed

---

## 30. Why records are kept separate

The entities are separate because they change at different times:

- A route can remain the same while departures change daily.
- A vehicle can serve different schedules.
- A vehicle template can change for future departures without corrupting old tickets.
- A hotel room type describes a category, while units and nightly availability change independently.
- A booking stores immutable traveler/guest snapshots so later profile edits do not rewrite issued tickets.
- Manifests are derived operational views, not independent passenger databases.

This separation prevents overselling, cross-company leakage, stale data, and historical corruption while keeping the interface simple through filtered selectors and dependency-ordered setup.

---

# Part G — Dashboard guidance and exact dependency matrix

## 31. Embedded dashboard guides

Every dashboard now contains a role-specific guide inside the interface:

- **Super Admin:** partner verification, platform governance, role boundaries, suspension, and audit.
- **Operations:** readiness, live inventory, manifests, check-in, incidents, and completion.
- **Finance:** payment verification, ledger splits, reconciliation, refund controls, settlement, and payout.
- **Support:** booking context, correspondence timeline, replies, reschedules, refund escalation, and resolution.
- **Content:** selecting approved marketplace records, moderation, publishing, expiry, and campaign monitoring.
- **Company Admin:** service setup in dependency order, daily work, revenue, and settlement.
- **Company Employee:** company/branch/listing/schedule scope, permissions, daily actions, handover, and audit.
- **Driver:** verification, vehicle/schedule assignment, manifest, trip updates, incidents, and completion.
- **Promoter:** selected listing, tracked link, attribution, commission, fraud review, and payout.
- **Customer:** discovery, inventory selection, cart/hold, payment, ticket, travel/stay, and after-service actions.

The guides explain what must exist first, what is selected, what is typed, what is automatically generated, and which later feature consumes each record.

## 32. Bus dependency matrix

| Feature / field | Source | User action | Used by |
|---|---|---|---|
| Company | Partner onboarding | Enter legal business facts, then Super Admin verifies | Every company-owned record |
| Branch / terminal | Company Setup | Create once | Listing, route stops, staff scope, manifests |
| Bus Listing | Company Setup | Select primary branch; type public title/corridor/media/rules | Route, vehicle, booking discovery |
| Route | Bus Listing | Select listing, origin branch, destination branch, and owned stops | Schedule |
| External/public stop | Route | Type public name only when it is not an owned branch | Customer boarding/drop-off information |
| Vehicle | Bus Listing | Select listing; type plate/name/capacity | Seat template, schedule, driver assignment |
| Seat template | Vehicle | Configure layout/seat class once | Copied into schedule seats |
| Driver | Staff | Select branch/listing/schedule scopes; approve licence and safety | Assignment, schedule, driver dashboard |
| Schedule | Route + Vehicle + Driver | Select existing records; type departure/arrival/fare | Live seats, booking, manifest, check-in |
| Schedule seat | Generated from vehicle template | Select or operationally change state | Hold, ticket, manifest, check-in |
| Booking | Listing + Schedule + Seat | Customer/staff selects existing inventory | Passenger snapshot, ticket, payment, support |
| Passenger manifest | Generated from schedule bookings | Filter/select schedule | Driver and operations work |
| Settlement | Successful booking/payment | Generated and reviewed | Company, promoter, finance dashboards |

## 33. Hotel dependency matrix

| Feature / field | Source | User action | Used by |
|---|---|---|---|
| Company | Partner onboarding | Enter legal business facts, then Super Admin verifies | Every hotel-owned record |
| Branch / front desk | Company Setup | Create once | Listing, staff scope, policy, operations |
| Hotel Listing | Company Setup | Select operating branch; type public content | Property and customer discovery |
| Hotel Property | Hotel Listing | Select listing; type physical address/rules | Room type |
| Room Type | Listing + Property | Select both; type category/capacity/bed/base price | Room unit and booking |
| Room Unit | Room Type | Select room type; type physical room number | Housekeeping and room-night inventory |
| Room-night inventory | Room Unit + date | Select room type/unit; choose dates/status/price | Availability, hold, booking |
| Hotel Booking | Listing + dates + Room Type | Select available inventory | Guest snapshot, stay, payment, arrivals |
| Check-in / checkout | Existing booking + room unit | Select eligible booking/unit | Occupancy, housekeeping, settlement |
| Settlement | Successful completed stay/payment | Generated and reviewed | Company, promoter, finance dashboards |

## 34. Employee and driver scope matrix

A company administrator may select these scopes for staff:

- `branchId`: one active company branch, terminal, property, or front desk.
- `listingIds`: zero or more active listings owned by the same company.
- `scheduleIds`: zero or more non-cancelled schedules owned by the same company; when listing scope is set, every schedule must belong to one of those listings.
- `permissions`: only the actions required for the staff role.
- `vehicleId`: an optional company-owned vehicle for a driver request/profile.
- `scheduleId`: an optional company-owned schedule; when both vehicle and schedule are selected, they must match.

The backend rejects foreign, archived, cancelled, mismatched, or missing relationship records even if a malicious request bypasses the interface.

## 35. Why some names are still typed

A typed name is correct only when creating a new record or recording public/external information. Examples:

- New company, branch, listing, route, vehicle, property, room type, or room-unit name.
- External roadside stop that is not owned as a company branch.
- Customer/passenger/guest name and contact.
- Public description, note, address, instruction, policy, incident, or support message.

After that record exists, every later feature selects it from an ownership-filtered list. The platform never asks users to type internal database IDs.
