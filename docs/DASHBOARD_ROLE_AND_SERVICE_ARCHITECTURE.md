# Classic Trip Dashboard Role and Service Architecture

This pass keeps one visual dashboard shell: `src/views/dashboards/admin/index.ejs`.

No new dashboard design was introduced. Role and service differences are handled by config, controller data, route aliases, active page detection, and company-scoped data.

## Shared dashboard rule

Every dashboard must use:

- The same admin dashboard shell
- The same sidebar/topbar/card/table/modal styles
- The same JavaScript initialization safeguards
- A config-driven sidebar
- Role-scoped data and permissions
- Company-scoped authorization where company data is involved

## Role dashboards now configured

- Super Admin
- Company Admin
- Company Employee
- Driver
- Customer
- Promoter / Agent
- Support
- Finance
- Operations

Each role has a feature list in `src/config/dashboardFeatures.js`.

## Service category dashboards now configured

- Bus Dashboard
- Hotel Dashboard
- Flight Dashboard
- Train Dashboard
- Tour Dashboard
- Car Rental Dashboard
- Events Dashboard
- Cargo Dashboard
- Insurance Dashboard
- Corporate Travel Dashboard
- Loyalty Dashboard

Bus and Hotel are marked core/live. Future categories are feature-flagged in the UI until their backend, inventory, booking, payment, ticket/voucher, support, settlement, reports, and tests are fully implemented.

## Important files changed

- `src/config/dashboardFeatures.js`
- `src/config/dashboardMenus.js`
- `src/services/dashboard/shellConfig.js`
- `src/views/dashboards/admin/index.ejs`
- `src/controllers/admin/dashboardController.js`
- `src/controllers/company/dashboardController.js`
- `src/controllers/employee/dashboardController.js`
- `src/controllers/employee/driverController.js`
- `src/controllers/customer/dashboardController.js`
- `src/controllers/promoter/dashboardController.js`
- `src/routes/web/admin.js`
- `src/routes/web/company.js`
- `src/routes/web/employee.js`
- `src/routes/web/customer.js`
- `src/routes/web/promoter.js`

## Next backend implementation order

1. Fully wire Bus Dashboard backend actions and tables.
2. Fully wire Hotel Dashboard backend actions and tables.
3. Keep future categories feature-flagged/read-only until complete end to end.
4. Add controller/service/repository/audit/notification/report/test coverage for each category before enabling checkout.
