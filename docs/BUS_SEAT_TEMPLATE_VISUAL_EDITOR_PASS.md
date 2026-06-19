# Bus Seat Template Visual Editor Pass

This pass continues the Bus Company Admin implementation while keeping the existing shared Super Admin dashboard shell.

## Implemented

- Added a vehicle seat-template workbench inside the Bus Seat Maps dashboard.
- Added per-vehicle template cards with mini visual seat previews.
- Added a reusable seat-template builder modal.
- Added support for custom seat labels, VIP/premium seats, disabled/non-passenger spaces, initially blocked seats, default seat class, VIP price delta, and preserve/rebuild schedule snapshots.
- Added a company-scoped POST route for selecting a vehicle from the template builder: `/company/vehicles/seat-template`.
- Existing per-vehicle route still works: `/company/vehicles/:id/seats`.
- Backend now persists richer vehicle seat templates and can rebuild draft/active/published schedule seat snapshots when requested.
- Added dashboard validation coverage for the seat-template workbench and route.

## Notes

The dashboard UI shell was not redesigned. This pass only improves the Bus Seat Maps functionality and template workflow.
