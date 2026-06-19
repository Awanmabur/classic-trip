# Company Type Single Service Dashboard Rule

Classic Trip now follows this dashboard rule:

- Super Admin can see every service dashboard: bus, hotel, flight, train, tour, car rental, events, cargo, insurance, corporate travel, and loyalty.
- Company Admin can see only one service category, based on `company.companyType`.
- A bus company account opens a bus company workspace only.
- A hotel company account opens a hotel company workspace only.
- A flight, train, tour, car rental, event, cargo, insurance, corporate, or loyalty partner opens only its own service workspace.
- All roles reuse the same existing Super Admin dashboard shell. Only menu, data, permissions, page labels, and actions change.

Implementation points:

- `src/services/data/demoStore.js` builds `serviceProfile` from the company primary `companyType`, not from mixed service assets.
- `src/config/dashboardMenus.js` no longer gives Company Admin a list of every service dashboard.
- `src/controllers/company/dashboardController.js` filters `dashboardFeatures.services` to the company primary service only.
- `src/services/dashboard/shellConfig.js` filters Company Admin sidebar items through `serviceProfile.visiblePages`.
- Manual requests to another service dashboard route are forced back to `overview`.

This prevents a bus company from seeing hotel operations and prevents a hotel company from seeing bus operations.
