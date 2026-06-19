# Employee Role Dashboard Page Layout Fix

## Scope
Fixed company employee role dashboards so Driver, Company Staff, Support, Finance, and Operations pages no longer render empty placeholder pages or appear pushed below the dashboard/footer.

## Changes
- Moved dynamic role pages into the main dashboard content area before `</main>`.
- Replaced generic checklist-only pages with role-specific connected pages.
- Added real role workspaces for:
  - Ticket check-in
  - Schedules
  - Driver assigned trips
  - Driver manifest
  - Driver incidents
  - Service inventory
  - Shift handover
  - Profile
  - Wallet
  - Security
- Added table population hooks for dynamic role pages using existing dashboard data:
  - `checkins`
  - `schedules`
  - `driverOps`
  - `driverIncidents`
  - `inventory`
  - `handovers`
  - `payments`
- Added role-page styling to remove blank gaps and keep the selected page directly under the top navigation.

## Validation
- `npm run check`
- `npm run check:dashboards`
- `npm run check:dashboard-smoke-static`
