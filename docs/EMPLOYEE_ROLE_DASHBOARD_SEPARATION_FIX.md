# Employee Role Dashboard Separation Fix

This pass fixes company employee/staff dashboards so they no longer show the same generic fallback content or empty pages.

## Fixed

- Added distinct role workspace sections for:
  - Driver assigned trips
  - Driver/company manifest
  - Driver incidents
  - Service inventory
  - Shift handover
  - Role profile
- Added real table bindings for employee/driver role pages:
  - `employeeDriverOpsTable`
  - `employeeManifestTable`
  - `employeeIncidentsTable`
  - `employeeTripStatusTable`
  - `employeeInventoryTable`
  - `employeeHandoverTable`
- Fixed page aliases where menu pages did not match real section IDs:
  - `checkin` opens the real check-ins page
  - `schedule` opens the real schedules page
- Fixed active menu highlighting for aliased pages.
- Support, Finance, and Operations dashboards now receive role-scoped data instead of the same admin dashboard payload.
- Support dashboard focuses on support tickets, refunds, customer lookup, and booking lookup.
- Finance dashboard focuses on payments, refunds, settlement, payout requests, and statements.
- Operations dashboard focuses on schedules, inventory, check-ins, incidents, and trip status updates.

## Checks

- `npm run check`
- `npm run check:dashboards`
- `npm run check:dashboard-smoke-static`
