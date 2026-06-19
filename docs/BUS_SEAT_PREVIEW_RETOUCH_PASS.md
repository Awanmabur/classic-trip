# Bus Seat Preview Retouch Pass

This pass retouches the dashboard Visual Seat Preview and its route/schedule filter area without changing the shared dashboard shell.

## Changes

- Reorganized the route/schedule filter into a cleaner operational selector bar.
- Added scoped summary stats beside the selector: total seats, booked seats, held seats, and blocked seats.
- Updated the stats dynamically when a different route/schedule is selected.
- Improved the bus cabin preview spacing, width, and visual balance.
- Made the bus cabin slightly wider while preserving the tall bus shape.
- Increased seat row consistency and gap clarity.
- Kept the existing Seat No numeric display and color rules.
- Kept the selected route/schedule behavior: selected map first, scoped list table below.

## Validation

- `npm run check`
- `npm run check:dashboards`
