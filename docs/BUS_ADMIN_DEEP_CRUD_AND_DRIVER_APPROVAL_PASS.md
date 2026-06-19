# Bus Admin Deep CRUD and Driver Approval Pass

This pass continues the bus company admin implementation while keeping the existing shared Super Admin dashboard shell.

## Implemented

### Bus route and stop management
- Added backend service methods for route stops:
  - `createRouteStop`
  - `updateRouteStop`
  - `archiveRouteStop`
- Route update now supports richer route fields:
  - route name
  - origin/destination terminals
  - distance
  - duration
  - operating days
  - public instructions
  - stop replacement through `stops`
- Route snapshots are refreshed after stop changes.
- Added routes:
  - `POST /company/routes/:id/stops`
  - `POST /company/route-stops/:stopId`
  - `POST /company/route-stops/:stopId/archive`

### Vehicle and seat-template management
- Added backend service methods:
  - `updateVehicleSeatTemplate`
  - `updateVehicleStatus`
- Company Admin can now update vehicle layout/capacity and status without changing dashboard UI.
- Added routes:
  - `POST /company/vehicles/:id/seats`
  - `POST /company/vehicles/:id/status`

### Schedule lifecycle management
- Added backend service methods:
  - `transitionSchedule`
  - `duplicateSchedule`
- Company Admin can now publish, update status, duplicate, or archive schedules.
- Added routes:
  - `POST /company/schedules/:id/status`
  - `POST /company/schedules/:id/duplicate`

### Dashboard row actions
- Existing dashboard table row actions now expose service-scoped actions for Company Admin:
  - publish/archive listing
  - add route stop
  - archive route
  - edit vehicle seat template
  - update vehicle status
  - publish/update/duplicate/archive schedule
- Actions are shown inside the same dashboard shell and use CSRF-protected POST forms.

### Super Admin driver request approval
- Company driver requests are now connected to Super Admin approval.
- Added backend actions:
  - `approveDriverRequest`
  - `rejectDriverRequest`
- Approval creates/updates:
  - driver user
  - company employee driver profile
  - optional driver assignment when vehicle/schedule was requested
  - support ticket status
  - audit log
- Added routes:
  - `POST /admin/driver-requests/:id/approve`
  - `POST /admin/driver-requests/:id/reject`

### Validation
- Updated `scripts/validate-dashboard-scope.js` so future changes must keep these bus admin routes and form configs present.

## Checks
- `npm run check`
- `npm run check:dashboards`

Both passed in this extracted environment.

## Not completed yet
- Full inline edit forms for every record field are still limited by the current shared modal model.
- Full browser/EJS render test was not run because `node_modules` are not installed in the extracted environment.
- Full Jest suite was not run for the same reason.
