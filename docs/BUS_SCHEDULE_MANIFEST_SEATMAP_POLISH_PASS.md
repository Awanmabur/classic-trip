# Bus Schedule, Manifest, and Seat Map Polish Pass

This pass continues the bus company dashboard implementation without changing the shared dashboard shell.

## Implemented

- Reduced the aside spacing slightly while keeping readable long labels and rounded active state.
- Added dashboard filter bars to:
  - Seat Maps
  - Passenger Manifest schedules
  - Passenger-level boarding list
- Filters support search, status/select filters, reset buttons, and empty-state messages.
- Added a schedule publish readiness action next to schedule publish.
- Publish readiness opens a view modal and shows schedule readiness data, route, vehicle, fare, departure, seats, and validation failures where available.
- Improved the Seat Maps page with a clearer operations/control area and filterable seat-map table.
- Improved Passenger Manifests with filterable schedule and passenger tables.
- Kept row-click view modal behavior and row action buttons.
- Kept company service scoping intact.

## Current status

Bus dashboard is now more operationally usable:

1. Create listing, routes, stops, vehicles, seat templates, and schedules.
2. Check schedule publish readiness before publishing.
3. Publish, duplicate, complete, or archive schedules.
4. Use Seat Maps to inspect seats and update seat status.
5. Use Passenger Manifests to filter schedules and passengers, open tickets, check in, no-show, and export.
6. Completion releases eligible earnings through the existing settlement path.

## Remaining before moving fully beyond bus

- Add richer seat-template visual editing for row/column/deck drag-like configuration.
- Add stronger inline validation summaries when a publish POST fails.
- Add browser E2E tests once dependencies are installed.
- Continue Hotel dashboard deep operations next: property hierarchy, room type/unit CRUD, room-night calendar, guest manifests, check-in/check-out, and settlement.
