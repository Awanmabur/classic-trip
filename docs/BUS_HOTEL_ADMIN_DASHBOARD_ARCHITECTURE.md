# Classic Trip Bus/Hotel Company Admin Dashboard Architecture

This cleanup pass starts the company-admin dashboard again with the Super Admin dashboard shell as the visual and structural standard.

## Scope of this pass

The first dashboard focus is the verified company workspace for bus and hotel operations. It does not implement flights, trains, tours, car rental, cargo, insurance, or loyalty booking flows. Those services must remain hidden, teaser-only, or feature-flagged until their backend, frontend, payment, ticketing, support, settlement, and reporting flows are complete.

## Dashboard shell rule

All dashboards must use the same dashboard chrome:

- one sidebar partial: `src/views/partials/dashboard-sidebar.ejs`
- one topbar partial: `src/views/partials/dashboard-topbar.ejs`
- config-driven menus: `src/config/dashboardMenus.js`
- role-scoped data from `src/services/dashboard/*`
- page-specific content only inside the main area

The Super Admin dashboard remains the source of visual truth. Company, employee, driver, customer, promoter, support, finance, and operations dashboards should not create separate unrelated shells.

## Company Admin flow

Correct flow:

1. Super Admin invites and verifies the company.
2. Company completes profile, branches, policies, support contacts, payout account, and documents.
3. Company invites non-driver staff.
4. Company requests driver onboarding; Super Admin approves driver invitation/activation.
5. Company creates bus routes, route stops, vehicles, seat maps, schedules, and fares.
6. Company creates hotel property, room types, room units, room-night inventory, and pricing.
7. Customer booking uses protected seat/room holds.
8. Payment success issues booking, ticket/QR, receipt/invoice, notification, ledger, and pending commission/settlement records.
9. Employee/driver/hotel staff checks in customer.
10. Completion releases company earnings according to settlement rules.
11. Support, refunds, reschedules, no-shows, and reports remain linked to the booking timeline.

## Implemented files in this pass

- `src/views/dashboards/company/bus-hotel-admin.ejs`
- `public/css/dashboard-bus-hotel-admin.css`
- updated `src/controllers/company/dashboardController.js`
- updated `src/config/dashboardMenus.js`
- updated `src/views/partials/dashboard-sidebar.ejs`

## Company dashboard menu

- Overview
- Company Profile
- Staff & Driver Requests
- Routes & Stops
- Vehicles
- Seat Maps
- Schedules & Fares
- Hotel Rooms
- Bookings
- Manifests
- Check-ins
- Support
- Reviews
- Revenue
- Settlement
- Reports

## Backend entities required for this dashboard

Company setup:
- Company
- CompanyBranch
- CompanyPolicy
- CompanyEmployee
- Invitation
- VerificationReview
- DriverAssignment

Bus operations:
- Listing
- Route
- RouteStop
- Vehicle
- Seat
- TripSchedule
- InventoryHold
- Booking
- Passenger
- TicketScan
- TripStatusUpdate
- DriverIncident

Hotel operations:
- HotelProperty
- RoomType
- RoomUnit
- RoomNightInventory
- StayRule
- Booking
- Passenger or Guest

Finance and operations:
- Payment
- PaymentIntent
- Wallet
- WalletTransaction
- Commission
- PayoutRequest
- RefundRequest
- SupportTicket
- CorrespondenceMessage
- Notification
- AuditLog

## Backend enforcement required next

Every POST/PUT/DELETE route under the company dashboard must enforce both role and company scope:

```js
requireAuth
requireRole('company_admin')
requireCompanyAccess({ source: 'params.companyId or body.companyId or session.user.companyId' })
```

Do not rely on role alone. Company A must never access Company B inventory, bookings, passengers, revenue, settlement, staff, reports, or support cases.

## End-to-end completion checklist for every company action

For each feature page, implement:

1. Mongoose model and indexes.
2. Route.
3. Controller validation.
4. Service/use-case business rules.
5. Repository persistence.
6. Company-scope authorization.
7. EJS form/table/empty state/error state/success state.
8. Audit log.
9. Notification or correspondence event where relevant.
10. Report visibility where relevant.
11. Tests for success, validation failure, permission failure, and edge cases.

## Immediate next build order

1. Wire real POST routes for company profile, branches, policies, staff invite, driver request, routes, route stops, vehicles, seat maps, schedules, hotel property, room type, room unit, and room-night inventory.
2. Add action-level company authorization middleware to every company write route.
3. Move all company write logic into service files, not EJS scripts.
4. Add audit logging for every create/update/delete/publish/cancel/check-in/refund/payout-related action.
5. Add atomic hold logic for bus schedule seats and hotel room-nights.
6. Add printable manifest routes for bus schedule and hotel arrival/departure/in-house lists.
7. Add tests for bus schedule publishing, room-night publishing, seat/room hold, booking, payment, ticket, check-in, duplicate scan rejection, and settlement release.

## Non-negotiable rules

- No company self-activation.
- No driver self-activation.
- No live inventory from unverified/suspended companies.
- No booking without inventory hold.
- No ticket issuance before successful payment, except explicit offline/manual reservation states.
- No payout without ledger records.
- No support/refund/reschedule action without booking timeline entry.
- No future service appears as a broken checkout flow.
