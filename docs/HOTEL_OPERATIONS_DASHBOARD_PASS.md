# Hotel Operations Dashboard Pass

This pass continues the shared-dashboard implementation by adding a clearer end-to-end Hotel Company Admin operations layer while keeping the same Super Admin dashboard shell.

## Implemented

- Reorganized the Hotel Rooms page into a full hotel operations workspace.
- Added hotel hierarchy controls:
  - Add property
  - Add room type
  - Add room units
  - Add room-night inventory
- Added hotel summary metrics for properties, room types, units, and room-night rows.
- Added filtered tabs for:
  - Properties
  - Room types
  - Room units
  - Room-night calendar
  - Housekeeping
- Added a clearer room visual map with room tiles that open row-level view modals.
- Added hotel row actions:
  - property manifest/PDF/archive actions
  - room type add-units/add-night-inventory/archive actions
  - room unit housekeeping/archive actions
  - room-night status/check-in/check-out/archive actions
- Added hotel manifest tabs:
  - all guests
  - arrivals
  - in-house guests
  - departures
- Added hotel route aliases:
  - /company/hotel-properties
  - /company/room-types
  - /company/room-units
  - /company/room-calendar
  - /company/arrivals
  - /company/departures
  - /company/in-house-guests
  - /company/housekeeping

## Still to continue next

- Add hotel booking form fields for check-in/check-out date range, room type, and room unit selection.
- Add stronger room-night availability validation in the company dashboard flow.
- Add printable hotel arrival/departure/in-house pages from dashboard actions.
- Add dedicated hotel guest detail page if needed.
- Add audit timeline for hotel check-in/check-out and housekeeping changes.

Checks passed:

```bash
npm run check
npm run check:dashboards
```
