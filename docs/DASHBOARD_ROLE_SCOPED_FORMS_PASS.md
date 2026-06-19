# Dashboard role-scoped forms pass

This pass continues the dashboard implementation without changing the existing Super Admin dashboard UI.

## What changed

- Company Admin create/edit modals are now role-aware.
- Company Admin dashboard forms now post to company-scoped endpoints instead of Super Admin endpoints.
- Bus companies can create bus listings, routes, vehicles, and schedules from the shared dashboard shell.
- Hotel companies can create hotel properties and room inventory from the shared dashboard shell.
- Generic provider companies create only their own service type records.
- Company listing POST routes now enforce that a company can only create/update records for its own `companyType`.

## Important endpoints now used by Company Admin modals

- `POST /company/listings`
- `POST /company/bookings`
- `POST /company/routes`
- `POST /company/vehicles`
- `POST /company/schedules`
- `POST /company/rooms`

## Security rule

A company account cannot submit a different `serviceType` than its assigned company type. For example:

- Bus company cannot create hotel listings.
- Hotel company cannot create bus routes or vehicles.
- Cargo company cannot create bus/hotel inventory.

This is enforced by `requireCompanyOwnService('serviceType')` in `src/middlewares/companyAccess.js` and `src/routes/web/company.js`.

## Validation

Run:

```bash
npm run check
npm run check:dashboards
```
