# Bus Seat Map and Passenger Manifest Operations Pass

This pass continues the shared-dashboard implementation without changing the dashboard design.

## Implemented

- Added a bus seat operations panel inside the Seat Maps page.
- Added a company-scoped seat status modal posting to `/company/seats/status`.
- Seat status modal supports schedule selection, seat selection, status selection, and operational notes.
- Visual seat buttons now open curated seat details instead of generic/empty view modals.
- Visual seats now show a small marker when connected to a booking/ticket.
- Seat view modal now includes ticket/customer/status details and action buttons for status update and ticket access.
- Passenger Manifests now include a passenger-level boarding table below the schedule manifest table.
- Passenger rows include seat, passenger, booking ref, phone, payment, check-in, status, and operational actions.
- Passenger-level view modal now shows curated passenger, booking, and trip groups.
- Passenger-level actions include ticket view, manual check-in, and no-show marking.
- Dashboard validation now checks that passenger-level manifests and seat status operations remain present.

## Kept unchanged

- Same shared Super Admin dashboard shell.
- Same role/service sidebar model.
- Same companyType scoping.
- Same POST logout behavior.

## Checks run

```bash
npm run check
npm run check:dashboards
```

Both checks passed in this extracted environment.
