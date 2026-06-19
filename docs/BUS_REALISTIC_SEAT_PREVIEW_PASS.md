# Bus Realistic Seat Preview Pass

This pass replaces the old generic visual seat preview with a more realistic bus cabin preview while keeping the shared Super Admin dashboard shell.

## Implemented

- Added a bus cabin container with front windshield, front door, driver pod, aisle, rear/emergency exit, and row-based seats.
- Seats are arranged in a 2 + aisle + 2 pattern instead of a flat demo grid.
- Existing seat statuses remain clickable and open the existing seat view modal.
- Booked/ticketed seats keep the ticket marker.
- Status colors remain mapped to available, booked, held, blocked, maintenance, and disabled states.
- Mobile layout remains responsive.
- Dashboard validation now checks for the real cabin preview selectors.

## Files changed

- `src/views/dashboards/admin/index.ejs`
- `scripts/validate-dashboard-scope.js`

## Checks

- `npm run check`
- `npm run check:dashboards`
