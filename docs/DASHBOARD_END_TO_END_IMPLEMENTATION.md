# Dashboard End-to-End Implementation Pass

This pass keeps one dashboard UI shell only: `src/views/dashboards/admin/index.ejs`.

## Core rules implemented

1. Super Admin keeps the full marketplace dashboard and can see every service category.
2. Company Admin uses the same dashboard shell, but its sidebar, page labels, actions, and data are generated from `company.companyType`.
3. One company account maps to one service category only.
4. Bus company dashboards never show hotel/room modules.
5. Hotel company dashboards never show bus route/vehicle/seat-map modules.
6. Employee dashboards are service-aware based on the assigned company service type.
7. Logout is a POST action in the shared topbar/sidebar, not a logout page.
8. Old separate dashboard views were removed so every role uses the same admin dashboard shell.

## Main files changed

- `src/services/dashboard/shellConfig.js`
  - Central role + service sidebar builder.
  - Company service menus for bus, hotel, flight, train, tour, car rental, event, cargo, insurance, corporate, loyalty.
  - Employee service menus for bus, hotel, cargo, and default service staff.

- `src/views/dashboards/admin/index.ejs`
  - Shared shell for all dashboards.
  - Company overview text, quick actions, labels, and page metadata now respect the current service profile.
  - Logout remains a POST form.

- `src/routes/web/company.js`
  - Service guards added to service-specific POST actions.
  - Hotel endpoints require `companyType=hotel`.
  - Transport/service setup endpoints reject unrelated company types.

- `src/middlewares/companyAccess.js`
  - `requireCompanyService(...)` is used to protect service-only actions.

- `scripts/validate-dashboard-scope.js`
  - Static validation that bus/hotel/cargo sidebars do not leak wrong service wording or pages.
  - Confirms logout is not a GET dashboard page.
  - Confirms old role-specific dashboard view files are removed.

## Verification commands

```bash
npm install
npm run check
npm run check:dashboards
npm test
```

In this environment, `node_modules` were not installed, so Jest could not run here. The syntax check and dashboard scope validator passed.
