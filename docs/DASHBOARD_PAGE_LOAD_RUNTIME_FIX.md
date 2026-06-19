# Dashboard Page Load Runtime Fix

This pass fixes the dashboard page-loading failure caused by a browser-side JavaScript runtime error.

## Root cause

The shared dashboard EJS file used `companyServiceProfile` inside the inline dashboard script, but that variable only existed in the server-side EJS scope. After rendering, the browser did not have a JavaScript variable named `companyServiceProfile`, causing:

```text
ReferenceError: companyServiceProfile is not defined
```

Because the error happened before dashboard initialization completed, page switching and role/service aside behavior could fail in the browser.

## Fix

The inline dashboard script now creates a browser-safe variable from the serialized dashboard data:

```js
const companyServiceProfile = data.serviceProfile || {};
```

This keeps the existing Super Admin dashboard shell unchanged and allows Company Admin, Employee, Customer, Promoter, Finance, Support, Operations, and Super Admin dashboards to initialize safely.

## Verified

- `npm run check`
- `npm run check:dashboards`
- Manual GET checks for admin, company, employee, promoter, and customer dashboard pages.
- Browser-runtime simulation confirmed `window.ClassicTripDashboardReady === true` after loading the company dashboard.
