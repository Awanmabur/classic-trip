# Hotel Housekeeping + Settlement Pass

This pass continues the hotel operations work after the room-calendar/stay operations layer.

## Implemented

- Added a dedicated hotel housekeeping task board in the Hotel Rooms dashboard.
- Added housekeeping summary metrics: open tasks, cleaning now, and maintenance.
- Added housekeeping filters for room/property/assignee/status.
- Added company-scoped housekeeping update endpoint:
  - `POST /company/hotels/housekeeping/:unitId`
- Added hotel housekeeping workflow in `hotelService.updateHousekeeping`.
- Housekeeping update supports:
  - housekeeping status
  - room status
  - task status
  - priority
  - assignee
  - due time
  - notes
- When housekeeping is marked clean/inspected, dirty/cleaning room units can return to available.
- When housekeeping is marked cleaning or maintenance, linked room-night statuses are updated.
- Added audit logging for housekeeping updates.
- Hotel successful payment now creates pending settlement/commission records.
- Hotel check-out now marks the stay completed and attempts to release eligible company/promoter earnings.
- Hotel check-out writes a settlement timeline event.

## Validation

- `npm run check`
- `npm run check:dashboards`

Both checks passed in this extracted environment.
