# Dashboard Page Content Mapping Fix

This pass fixes company employee, driver, bus, and hotel dashboard navigation so each sidebar item opens the correct in-dashboard content section instead of an empty fallback page or unrelated placeholder content.

## Fixed

- Bus Seat Map menu items now open the real Seat Maps section.
- Bus schedule/trip menu items now open the real Schedules section.
- Bus manifest/passenger list menu items now open the real Manifests section.
- Boarding/guest check-in menu items now open the real Check-ins section.
- Hotel room inventory/room calendar/housekeeping menu items now open the real Rooms & Inventory section.
- Payment menu items now open the real Revenue section.
- Payout/wallet menu items open Settlement.
- Staff profile menu items open Company Profile.
- Driver incidents route to Support/incident task content instead of an empty dynamic page.
- Employee and driver redirects now use real section hashes.

## Guard added

- Added `resolveDashboardPage()` in the shared dashboard shell to route legacy or role-specific page keys to real sections.
- Added `scripts/validate-dashboard-page-content.js`.
- Added `npm run check:dashboard-page-content`.

## Checks run

- `node --check` on modified JS files.
- `npm run check:dashboards`
- `npm run check:dashboard-smoke-static`
- `npm run check:dashboard-page-content`

Note: the full `npm run check` command timed out in this packaging environment, so targeted syntax checks were run for the modified files instead.
