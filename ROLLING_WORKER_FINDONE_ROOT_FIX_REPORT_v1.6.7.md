# Classic Trip v1.6.7 Rolling Worker `undefined.findOne` Root Fix

## Runtime failure reviewed

The reported startup sequence reached the worker correctly, but the rolling queue stopped after the first dated departure with:

```text
pending=29 skipped=1 failures=["Cannot read properties of undefined (reading 'findOne')"]
```

The important defect was not only the `TypeError`. The worker caught that internal runtime failure inside the per-date creation loop, converted it into a permanent skipped date, and then executed the permanent-blocker branch. That paused the complete rule until the next repair scan.

## Root repair

### 1. Removed the failing post-first-date path

The first dated departure was created successfully through `companyService.createScheduleBatch`, while the remaining dates switched to `busDepartureService.createScheduleSeries`. Version 1.6.7 removes that alternate worker repair path.

Every missing date in an existing rolling window now uses the same single-date batch creator as the first date:

- company, route, vehicle, seat map and fare ownership checks remain active;
- seat and segment inventory are still created transactionally;
- publication readiness is still evaluated;
- invalid permit/inspection/insurance keeps the departure as Draft;
- one date is created per worker batch with the existing two-second yield.

### 2. Internal TypeErrors no longer become permanent skips

`Cannot read properties of undefined`, null-property failures and `is not a function` errors are classified as internal runtime failures. They are rethrown to the bounded queue retry layer rather than incrementing `skipped` and pausing the rule as though the operator entered invalid business data.

### 3. Actionable worker diagnostics

A rolling retry now logs:

- company ID;
- rule ID;
- retry attempt;
- exact rolling stage;
- error code;
- message;
- stack trace.

This means any future repository contract issue will identify its actual source line.

### 4. Existing 29 pending dates recover automatically

No data migration or deletion is needed. The startup repair scan reopens the active rule, recognises the existing first departure, and creates the next missing date. The queue then re-adds the rule until the 30-day window is complete.

The vehicle operating permit remains a real publication requirement. It does not prevent Draft date creation.

## Regression coverage

A new runtime unit test constructs the exact state that failed:

- one existing dated departure;
- an active rolling rule;
- two missing future dates;
- one-date worker batch limit;
- missing operating permit publication blocker.

It verifies `created=1`, `draft=1`, `skipped=0`, and a decreasing pending count. A second test injects the exact `undefined.findOne` TypeError and verifies it is tagged `rolling_internal_runtime_failure` at stage `repair_existing_window_create` rather than returned as a skipped date.

## Checks completed

- New rolling worker unit tests: **2/2 passed**.
- Rolling worker root-fix source audit: **7/7 passed**.
- Performance/edit/payment repair audit: **23/23 passed**.
- JavaScript syntax validation passed for the repaired source.

Full dependency installation was attempted, but the repair environment's npm mirror returned HTTP 404 for:

```text
which-typed-array-1.1.20.tgz
```

Therefore the complete dependency-bound `npm run release:check` must be run in the normal local environment where `npm ci` already succeeds.
