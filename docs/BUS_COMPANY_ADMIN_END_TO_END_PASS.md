# Bus Company Admin End-to-End Implementation Pass

This pass continues from the shared-dashboard implementation and focuses on making the Bus Company Admin workflow functional without creating a new dashboard design.

## Scope completed

- Kept the existing Super Admin dashboard shell as the only dashboard UI.
- Corrected the Bus Company inventory button so it creates a bus listing before routes, vehicles, and schedules.
- Added Bus Company quick action for creating a bus listing.
- Added company-scoped modal forms for:
  - company profile update
  - staff invite
  - driver invitation request
  - branch / terminal creation
  - company policy creation
  - seat status / blocked-seat update
  - payout request
  - support notice
- Added route aliases for bus workflow URLs:
  - `/company/bus-listings`
  - `/company/routes-stops`
  - `/company/schedules-fares`
  - `/company/passenger-manifests`
  - `/company/boarding-checkins`
  - `/company/driver-requests`
- Added `POST /company/driver-requests` for company driver invitation requests.
- Driver requests are now recorded as scoped support tickets with `category: driver_invitation_request` and `status: pending_super_admin_approval`.
- Seat map updates now redirect back to `/company/seat-maps`, not `/company/rooms`.
- Branch and policy actions now redirect back to the company profile area.
- Company support notices now submit to `/company/support/notices`; Super Admin support notices continue to submit to `/admin/notices`.
- Updated dashboard validation to confirm these company-scoped routes/forms remain present.

## Business rule preserved

A Bus Company Admin account remains locked to `companyType: bus`. It can manage bus listings, routes, vehicles, seat maps, schedules, bookings, manifests, check-ins, support, revenue, settlement, and reports. It cannot access hotel room inventory or hotel actions.

## Next recommended implementation

1. Add edit/archive buttons for bus listings, routes, vehicles, and schedules from table actions.
2. Build route stop editor with multiple stops and pickup/drop-off offsets.
3. Build visual seat map editing beyond single-seat status updates.
4. Connect driver requests to the Super Admin invitation/verification pipeline.
5. Add browser E2E tests for bus admin create listing -> route -> vehicle -> schedule -> publish.
