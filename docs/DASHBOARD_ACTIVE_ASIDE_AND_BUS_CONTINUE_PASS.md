# Dashboard Active Aside and Bus Continue Pass

This pass keeps the same shared admin dashboard shell and applies the requested aside active-state polish.

## Implemented

- Active sidebar items now use the same pill-rounded edges as hover states.
- Active sidebar background is softer and stable during hover.
- The shared dashboard shell and the dashboard-shell CSS both include the final override so role dashboards and company/service dashboards stay visually consistent.
- Dashboard validation now checks that the active sidebar styling override exists.

## Current next implementation queue

The dashboard system is ready to continue into deeper operational modules. The next high-value work remains:

1. Finish Bus Seat Maps as a complete visual editor with row/column seat editing, blocking, maintenance, reserve, and ticket lookup per booked seat.
2. Finish Passenger Manifests with stronger passenger-level view/edit/no-show/check-in controls and PDF/CSV consistency.
3. Complete Hotel operational hierarchy with property, room type, room unit, room-night inventory, arrivals, in-house, departures, housekeeping, and guest check-in/out.
4. Replace the remaining fallback sections for Employee, Driver, Customer, Promoter, Finance, Support, and Operations with dedicated role pages.
5. Add browser/integration tests once dependencies are installed locally.
