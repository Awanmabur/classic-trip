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
