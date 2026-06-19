# Bus Production Hardening Pass

This pass continues the bus/hotel implementation by hardening the bus operational flow before expanding further.

## Implemented

- Strengthened schedule publish validation:
  - company must be verified and allowed to publish
  - listing must exist and not be archived
  - route must be active and include origin/destination
  - cancellation policy must exist from route or listing
  - vehicle must be active and not in maintenance/paused/archived states
  - vehicle must match the listing/route when linked
  - seat map must exist and include valid inventory
  - fare and currency are required
  - departure date/time is required and must be in the future
  - arrival must be after departure where provided
  - driver assignment remains required
  - vehicle schedule time conflicts are blocked
- Added route-stop ordering:
  - company route-stop move endpoint
  - move up/down service method
  - dashboard row actions for moving stops up/down
  - audit log for route-stop reorder
- Hardened bus seat holds:
  - central seat availability guard
  - blocks active duplicate holds before locking
  - blocks already booked seats
  - blocks unavailable operational states such as booked, checked-in, blocked, disabled, maintenance, cancelled, refunded
  - persistent MongoDB path checks active InventoryHold records before locking
- Improved manifest print readiness:
  - print CSS with A4 landscape sizing
  - print-only controls hidden
  - signature boxes for generated-by, boarding staff, and driver/supervisor
  - table print sizing improved for passenger manifests
- Added dashboard validation coverage so these changes are checked by `npm run check:dashboards`.

## Still next

- Full visual drag/drop seat-template editing.
- Stronger payment/hold transaction wrapping when MongoDB is live.
- Manifest browser visual test pass.
- Bus revenue and settlement drilldown.
- Hotel room calendar and housekeeping task board.
