# Shared Validation, Flash Feedback, and Route Smoke Pass

This pass stabilizes shared bus/hotel dashboard operations before deeper feature expansion.

## Implemented

- Added session-backed flash middleware mounted globally in `src/app.js`.
- Added generic success feedback for POST actions that redirect after saving.
- Added safe POST error handling in `src/middlewares/errorHandler.js`:
  - API requests still receive JSON errors.
  - Form POST failures redirect back with a visible flash error instead of dumping a raw 500/error page.
- Added dashboard flash banner rendering in the shared dashboard shell.
- Added client-side required-field validation for dashboard forms.
- Added inline field error styling and messages.
- Added executable Jest route smoke coverage in `tests/e2e/companyDashboardSmoke.test.js` for:
  - Bus company dashboard pages.
  - Hotel company dashboard pages.
  - POST failure flash redirect behavior.
- Added dependency-free static route smoke validation in `scripts/dashboard-route-smoke-static.js`.
- Added package scripts:
  - `npm run test:dashboard-smoke`
  - `npm run check:dashboard-smoke-static`

## Validated in this pass

- `npm run check`
- `npm run check:dashboards`
- `npm run check:dashboard-smoke-static`

`npm run test:dashboard-smoke` is included for environments with npm dependencies installed. The current packaging environment did not have `node_modules`, so the Jest smoke test could not be executed here.
