# Bus/Hotel Row View/Edit/Delete Modal Pass

This pass adds proper row-level View, Edit, and Delete/Archive modals for company-owned dashboard records while keeping the same shared Super Admin dashboard shell.

## Implemented

- Added row-level View/Edit/Delete buttons for mutable company records.
- Delete is a soft archive action, not a hard database delete.
- Delete/Archive submits real POST forms with CSRF instead of showing a fake toast.
- Edit modals now prefill available row detail data.
- Company edit forms post to company-scoped routes, not Super Admin routes.
- Added update/archive routes for hotel property, room type, room unit, and room-night inventory.
- Added hotel service methods for update/archive workflows.
- Added detail metadata to company rows so View/Edit modals have useful record data.

## Covered company records

Bus/company operations:

- Listing
- Route
- Route stop
- Vehicle
- Schedule
- Room legacy inventory where applicable

Hotel operations:

- Hotel property
- Room type
- Room unit
- Room-night inventory

## Safety rule

Company Admin edit/delete actions stay scoped to the authenticated company and service type. A bus company still cannot submit hotel actions, and a hotel company still cannot submit bus route/vehicle actions.

## Checks

- `npm run check`
- `npm run check:dashboards`
