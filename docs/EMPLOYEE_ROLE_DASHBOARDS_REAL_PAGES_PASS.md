# Employee Role Dashboards Real Pages Pass

This pass replaces empty/generic employee-role dashboard fallbacks with real shared-shell pages for company staff, drivers, support, finance, and operations roles.

## What changed

- Added real role-scoped dashboard sections for:
  - Check-in
  - Assigned schedules
  - Inventory
  - Manifest / assigned list
  - Trip / operations status
  - Incidents
  - Shift handover
  - My profile
- Added real tables for employee/driver/operations data:
  - `employeeCheckinTable`
  - `employeeScheduleTable`
  - `employeeInventoryTable`
  - `employeeManifestTable`
  - `employeeTripStatusTable`
  - `employeeIncidentsTable`
  - `employeeHandoverTable`
- Added role forms for:
  - check-in validation
  - schedule delay notice
  - inventory update
  - trip status update
  - incident report
  - shift handover
  - profile update
- Fixed support/finance/operations route access so their matching role keys can open their consoles:
  - `support_agent`
  - `finance_agent`
  - `operations_agent`
- Fixed `/support/dashboard/:page`, `/finance/dashboard/:page`, and `/operations/dashboard/:page` active-page resolution.
- Moved dynamic fallback sections above the dashboard footer so they do not render below the page and look broken.
- Added static smoke validation markers for the new employee-role pages.

## Checks

- `npm run check`
- `npm run check:dashboards`
- `npm run check:dashboard-smoke-static`
