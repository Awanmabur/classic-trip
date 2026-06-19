# Dashboard Pages Complete Pass

This pass continues the one-dashboard-shell implementation after the runtime page-load fix.

## Goal
Every sidebar item for every role must open a real page section in the shared admin dashboard shell. No role should click an aside item and land on a blank dashboard because the section is missing.

## What changed

- Kept the existing Super Admin dashboard UI shell.
- Added dynamic fallback dashboard sections for role pages that do not have a dedicated hard-coded section yet.
- Customer, employee, driver, promoter, support, finance, and operations menu items now always have a renderable section.
- The dynamic sections are not a new dashboard design. They reuse the same card, table, badge, button, and layout components already used by the Super Admin dashboard.
- Updated `scripts/validate-dashboard-scope.js` so it checks that all role menu pages either have a static section or are covered by the dynamic fallback renderer.
- Kept logout as `POST /logout` only. There is still no logout dashboard page.
- Kept company dashboard sidebars service-scoped by `companyType`.

## Important rules still enforced

- Bus company sidebar must not include hotel/room wording.
- Hotel company sidebar must not include bus/route/vehicle/seat-map wording.
- Cargo and other provider menus must not receive bus/hotel wording.
- Company Admin receives one service dashboard based on `companyType` only.
- Super Admin can see all service categories.
- Employee dashboard adapts to the assigned company service type.

## Checks run

```bash
npm run check
npm run check:dashboards
```

Both passed in this package.
