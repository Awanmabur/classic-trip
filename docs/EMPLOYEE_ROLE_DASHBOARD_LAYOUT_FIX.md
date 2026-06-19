# Employee Role Dashboard Layout Fix

This pass fixes the shared dashboard layout issue where company employee role pages such as Driver, Support, Finance, Operations, and other dynamic role sections were rendered after the main dashboard container.

## Fixed

- Moved dynamic role dashboard sections back inside the shared `<main class="main">` dashboard content area.
- Driver pages such as Assigned Trips, Manifest, Incidents, Check-in Assist, Seat Map, Support Tasks, Handover, and Profile now render in the same right-side content slot as normal dashboard pages.
- Company employee pages such as Ticket Check-in, Schedules, Inventory, Customers, Payments, Refunds, Support Tasks, Shift Handover, and Profile now render in the correct dashboard content area.
- Support, Finance, and Operations shell pages now also stay inside the main dashboard layout instead of appearing below the app/footer.
- Kept the existing Super Admin dashboard shell and did not redesign the shell.

## Validation

- `npm run check`
- `npm run check:dashboards`
- `npm run check:dashboard-smoke-static`
