# Hotel Booking, Availability, and Timeline Pass

This pass continues the hotel operations dashboard work while keeping the same shared Super Admin dashboard shell.

## Implemented

- Added company-scoped hotel manual booking route:
  - `POST /company/hotels/bookings`
- Hotel company booking modal now uses hotel-specific fields:
  - hotel listing
  - room type
  - optional preferred room units
  - check-in date
  - check-out date
  - room count
  - adults
  - children
  - lead guest contact
  - payment status
  - special stay requests
- Hotel booking creation now validates room-night availability for the full date range.
- Selected room units are respected when provided.
- Room-night rows are converted to booked only after availability passes.
- Manual hotel bookings from the dashboard now dispatch through the hotel booking service instead of the generic bus/seat booking service.
- Hotel booking timeline events are written for:
  - hotel booking created
  - room-night inventory booked
  - payment received or pending
  - hotel voucher issued
- Guest check-in and check-out now write hotel stay timeline events.
- Guest check-in redirects to the in-house guests dashboard.
- Guest check-out redirects to the departures dashboard.
- View modals now include curated hotel stay detail groups for hotel bookings and room-night rows.
- Dashboard validation now checks hotel booking/date-range/timeline wiring.

## Important rule preserved

A hotel company account can create and manage only hotel inventory and hotel stays. Bus routes, vehicles, seat maps, and schedules remain unavailable to hotel companies.

## Checks run

```bash
npm run check
npm run check:dashboards
```

Both checks passed in the extracted environment.
