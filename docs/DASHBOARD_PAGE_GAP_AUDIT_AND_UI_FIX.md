# Dashboard Page Gap Audit and UI Fix

This pass fixes the sidebar spacing and multi-option form UX, then records the current implementation gaps before the next feature pass.

## Changes made in this pass

- Reduced the dashboard aside spacing so the sidebar remains readable without large gaps.
- Kept long menu labels readable without cutting text.
- Added collapsible checkbox selectors for multi-option fields.
- Multi-option controls now fold open, allow checkbox selection, show selected count, and can be folded again.
- Replaced raw multi-select boxes for multi-option dashboard forms with the folded checkbox selector.
- Preserved the same shared Admin dashboard shell and did not create a new dashboard design.

## Current frontend connection status

### Connected and working at dashboard-shell level

- One shared dashboard shell is used: `src/views/dashboards/admin/index.ejs`.
- Sidebar is generated from role and company service type.
- Company dashboards remain scoped to `company.companyType`.
- Bus company dashboard does not intentionally expose hotel menu/actions.
- Hotel company dashboard does not intentionally expose bus menu/actions.
- Logout is a POST form action, not a page.
- Dashboard routes exist for the company dashboard aliases.
- View/Edit/Delete row modals exist and are wired through dashboard JavaScript.
- Table rows can open view modals.
- Forms use CSRF and company endpoints for company-owned records.
- Dashboard syntax and dashboard scope validation pass.

### Connected but still needs deeper completion

- Bus company admin has the strongest implementation so far: listings, routes, route stops, vehicles, schedules, seat-map status, manifests, check-ins, no-shows, operational tickets, timeline events, and schedule completion/settlement release hooks.
- Hotel company admin has route/controller/form structure for properties, room types, room units, room-night inventory, hotel manifests, check-in, and check-out, but it still needs the same deep visual polish and operational flow that bus received.
- Super Admin has service dashboards and approval routes, but service-category pages beyond bus/hotel are mostly structured dashboards and not full end-to-end operational modules yet.
- Customer, employee, driver, promoter, support, finance, and operations dashboards render in the shared shell, but several pages still use generic fallback panels rather than dedicated feature-specific layouts.

## Gaps to fix before expanding to the next large module

### 1. Bus dashboard remaining gaps

- Seat Maps: visual builder needs full drag/layout editing, not only seat status updates.
- Seat Maps: seat template creation should generate seats cleanly with rows/columns/deck rules.
- Passenger Manifests: layout is improved, but filters should be stronger: schedule, date, route, vehicle, driver, check-in state, payment state.
- Passenger Manifests: print preview should be tested in browser with real print CSS.
- Routes: route stop ordering should support move up/down or drag sorting.
- Schedules: fare classes need stronger linked data instead of free text.
- Schedules: recurring schedule creation is not complete.
- Driver assignment: Super Admin approval is connected, but final driver-to-schedule assignment UX needs a cleaner modal.
- Revenue/settlement: dashboard shows hooks, but ledger-level drilldown should be built per booking and per schedule.

### 2. Hotel dashboard remaining gaps

- Hotel property view/edit pages need the same curated layout quality as bus pages.
- Room type and room unit flows need a clear visual hierarchy: property -> room type -> room unit -> room-night inventory.
- Room calendar needs a true calendar/grid display rather than only tables.
- Arrivals, in-house guests, departures, check-in, check-out, and housekeeping should be separated into clean operational sections.
- Hotel manifests exist as routes, but dashboard actions need stronger row-level UX.
- Hotel revenue/settlement needs booking-level and stay-level drilldown.

### 3. Modal and form gaps

- View modals are now curated, but every entity type should be manually reviewed with real sample data.
- Edit modals should validate required fields per entity and show inline errors after failed POST.
- Delete/archive modal should show stronger warnings for records with bookings or active inventory.
- Some modal actions still depend on generic row metadata; deeper entity-specific modal payloads should be added.
- File upload fields are not yet consistently available in all edit modals that need media/documents.

### 4. Role dashboard gaps

- Employee dashboard needs service-specific dedicated pages, not generic fallback sections.
- Driver dashboard needs fully dedicated assigned-trip, passenger-manifest, seat-map, trip-status, and incident pages.
- Customer dashboard needs real ticket, receipt, refund, support, passenger profile, and review pages inside the shared shell.
- Promoter/Agent dashboard needs working referral link creation, campaign material download, offline sale creation, commission drilldown, and withdrawal request flows.
- Support dashboard needs a real case inbox, internal notes, customer-visible replies, refund/reschedule linkage, and escalations.
- Finance dashboard needs ledger, payout, reconciliation, commission, and refund pages with real filters and approval flows.
- Operations dashboard needs today departures, arrivals, delays/cancellations, incidents, and provider issues.

### 5. Service-category gaps beyond bus/hotel

- Flight, train, tour, car rental, event, cargo, insurance, corporate travel, and loyalty dashboards are currently structured service dashboards, not full bookable/service-complete modules.
- Future service pages should remain feature-flagged or read-only until each service has backend models, controllers, frontend forms, booking logic, payment logic, ticket/voucher logic, support, settlement, reports, and tests.

### 6. Backend/frontend connection gaps

- Several dashboard pages have routes that render the shared shell, but their POST actions need deeper validation, success/error flash states, and audit-log verification.
- Browser render testing is still needed after installing dependencies locally.
- Jest/full integration tests were not run in this environment because installed dependencies are not guaranteed here.
- Dashboard sections need real empty states and pagination for large datasets.
- More indexes and database-level uniqueness are needed for inventory holds and anti-double-booking.

## Recommended next fix order

1. Finish Bus Seat Maps and Passenger Manifests quality pass.
2. Complete Hotel dashboard page hierarchy and room calendar.
3. Replace generic employee/driver/customer/promoter fallback pages with dedicated layouts.
4. Add inline validation/error states to all create/edit modals.
5. Add tests for role/service menu scoping and modal POST guards.
6. Then continue to customer booking and payment hardening.

## Verification in this pass

- `npm run check` passed.
- `npm run check:dashboards` passed.

