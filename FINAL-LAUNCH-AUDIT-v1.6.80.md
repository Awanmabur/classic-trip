# Classic Trip v1.6.80 — Rolling Worker + Commercial Agreements Final Audit

## Purpose
v1.6.80 preserves the flexible Super Admin commercial-agreement engine from v1.6.79 and fixes the final rolling-departure unit regression found by the user's full local test run.

## Rolling-worker correction
- The test fixture now uses local calendar constructors so it is deterministic in both East Africa/Windows and UTC/Render environments.
- The mock repository no longer returns the rule's own existing departure as a fake vehicle-overlap row when the materializer performs its separate vehicle-conflict query.
- The expected one-date repair batch correctly targets 2026-08-07 when 2026-08-06 already exists and `maxCreates=1`.
- Runtime hardening from v1.6.78 remains: narrow repository contexts no longer throw an unscoped `undefined.findOne` error.

## Commercial agreements preserved
The most specific active terms still win: Platform fallback → Partner/company → Listing/service → Bus fare product/ticket class or Hotel room type. Partner payout is protected first; promoter rewards and customer discounts can consume only Classic Trip's agreed share. Every booking freezes the exact agreement version and computed split used at purchase time.

## Validation evidence
The user's v1.6.79 local run installed 217 packages with zero vulnerabilities and passed 114/115 unit tests. The only failing test was `rollingWorkerFindOneRepair.test.js`, where the fixture incorrectly reported two vehicle conflicts. In this artifact workspace the corrected targeted rolling-worker suite passes 2/2.

Dependency-free production gates should be rerun against this exact source, and the final local/CI gate remains `npm ci && npm test && npm audit --omit=dev --audit-level=moderate`. The target is 115/115 unit tests.

## Existing repository security blocker
The production ZIP is clean, but the user's existing Git history still contains an old MongoDB URI with embedded credentials. Rotate that credential and purge the historical secret before treating the Git repository itself as fully clean.
