# Dashboard aside and service-scope final fix

This pass corrects the shared dashboard behavior so every dashboard keeps the same existing Super Admin shell while the aside, actions, and service data are scoped correctly.

## Rules enforced

1. Logout is an action, not a dashboard page. The UI now submits `POST /logout` with CSRF from the shared sidebar/topbar.
2. Super Admin can see all service categories because it controls the whole marketplace.
3. Company Admin sees only the menu for its own `companyType`.
4. Bus company accounts do not see hotel room actions, hotel room aside items, room inventory pages, or room forms.
5. Hotel company accounts do not see bus routes, vehicles, seat maps, driver-request wording, or passenger-manifest wording.
6. Company Employee dashboards are service-aware. Bus employees see bus shift tools. Hotel employees see hotel shift tools. Cargo employees see cargo shift tools. Other service employees see generic service-work tools until their modules are fully implemented.
7. Hotel-only backend routes are guarded by `requireCompanyService('hotel')`, so bus company users cannot manually POST to room/hotel endpoints.

## Files changed

- `src/config/dashboardMenus.js`
- `src/services/dashboard/shellConfig.js`
- `src/controllers/employee/dashboardController.js`
- `src/controllers/employee/driverController.js`
- `src/middlewares/companyAccess.js`
- `src/routes/web/company.js`
- `src/views/dashboards/admin/index.ejs`
- `src/views/partials/dashboard-sidebar.ejs`
- `src/routes/web/auth.js`

## Verified checks

- Removed wrong labels: `Service Workspaces`, `Bus Desk`, `Hotel Desk`, `Cargo Desk`.
- Removed logout links/pages from the dashboard aside and topbar.
- Kept Super Admin as the single shared dashboard shell.
- `npm run check` passed.
