# Employee / Driver Role Dashboard Fix Pass

This pass fixes the company employee role dashboards that were opening as empty generic fallback pages or appearing far down the page.

## Fixed areas

- Added real shared-shell sections for staff role pages:
  - Ticket Check-in (`checkin`)
  - Schedules (`schedule`)
  - Driver Operations (`driver-ops`)
  - Driver Manifest (`driver-manifest`)
  - Driver Incidents (`driver-incidents`)
  - Service Inventory (`inventory`)
  - Shift Handover (`handover`)
  - My Profile (`profile`)

## UI improvements

- Reused the existing Super Admin dashboard shell instead of creating a separate design.
- Added organized role hero panels, role metric cards, scoped tables, and action panels.
- Stopped employee/driver pages from relying on the generic dynamic placeholder page.
- Pages now open in-place under the top navigation instead of leaving a blank area and pushing placeholder content down.

## Data wiring

- Role sections now read from the existing employee/driver dashboard payload:
  - `checkins`
  - `bookings`
  - `schedules`
  - `driverOps`
  - `driverIncidents`
  - `inventory`
  - `handovers`
  - `profile`
- Added table bindings:
  - `employeeCheckinsTable`
  - `employeeSchedulesTable`
  - `employeeDriverOpsTable`
  - `employeeManifestTable`
  - `employeeDriverIncidentsTable`
  - `employeeInventoryTable`
  - `employeeHandoversTable`

## Actions

- Ticket validation form now posts with `bookingRef`, matching the scanner controller.
- Driver update, incident report, and handover forms stay inside the shared role dashboard flow.

## Validation

- Extended dashboard static smoke validation to check employee/driver routes and role page markers.
- Checks passed:
  - `npm run check`
  - `npm run check:dashboards`
  - `npm run check:dashboard-smoke-static`
