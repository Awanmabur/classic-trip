# Bus Global Seat Number and Spacing Pass

Implemented after the seat preview runtime fix.

## Changes
- Standardized visible bus seat wording from `Seat No.` to `Seat Number` across dashboard and public UI.
- Updated generated bus vehicle seats, schedule seats, and seed/demo inventory to use clean numeric `seatNumber` values: `1`, `2`, `3`, and so on.
- Removed A1/B2-style bus seat generation from the company service, demo store, persistent store, and seed data.
- Kept the existing backend field name `seatNumber` for compatibility with models, routes, booking, holds, tickets, and manifests. The stored value is now the clean number sequence.
- Added `displayLabel: Seat Number X` to generated vehicle seats where applicable.
- Made bus seat cards equal width and height in dashboard and public booking pages.
- Increased the seat card width and improved consistent gaps between seats across the platform.
- Kept the requested colors:
  - Available: blue
  - Booked: red
  - Held: green
  - Selected: yellow
  - Blocked / maintenance: orange

## Verification
- `npm run check`
- `npm run check:dashboards`
