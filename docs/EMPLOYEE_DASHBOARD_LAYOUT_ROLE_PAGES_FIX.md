# Employee Dashboard Layout + Role Pages Fix

This pass fixes the company employee dashboard shell so driver, employee, support, finance, and operations dashboards do not open empty fallback sections or render below the main dashboard area.

## Fixed

- Kept all role dashboards inside the same admin dashboard shell.
- Moved dynamic role pages into the `<main class="main">` container instead of rendering after the footer.
- Added real role pages for:
  - Ticket / guest check-in
  - Assigned schedules
  - Driver operations
  - Driver manifest
  - Driver incidents
  - Service inventory
  - Shift handover
  - My profile
- Wired role-page tables to existing read-model data:
  - `checkins`
  - `schedules`
  - `driverOps`
  - `tripStatusUpdates`
  - `driverIncidents`
  - `inventory`
  - `handovers`
- Fixed dashboard layout so content does not hide behind the sidebar/aside.
- Added responsive sidebar behavior:
  - desktop: sidebar stays in its grid column
  - mobile/tablet: sidebar slides over content with backdrop
- Kept the same dashboard UI shell and avoided creating a separate dashboard design.

## Validation

- `npm run check`
- `npm run check:dashboards`
- `npm run check:dashboard-smoke-static`
