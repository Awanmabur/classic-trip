# Classic Trip v1.6.55 — Dashboard State & Public Departures Audit

## Scope

This release fixes archived records blocking replacement creation, dashboard writes redirecting away from the page where the user acted, inconsistent Bus departure counts, and Published departure creation silently resulting in Draft inventory.

## Implemented

- A shared dashboard mutation layer preserves the initiating dashboard page for successful create/edit/delete/archive/publish actions and invalidates dashboard plus marketplace snapshots after writes.
- Live-resource unique indexes exclude archived states where replacement creation is expected. `npm run repair:archive-uniqueness` reconciles existing database indexes serially while historical records retain their IDs and references.
- Bus public cards, listing preview and dashboard listing projection derive counts from the same future public departure set: `published`, `boarding`, and `delayed` only.
- Published one-off batches preflight all requested dates before writing. If publication readiness fails, the batch is not silently saved as Draft.
- Published rolling creation preflights readiness before creating the recurring rule.
- Existing future Draft departures can be retried with **Publish ready drafts** after compliance, fares, seat map and inventory blockers are corrected. Drafts remain private until publication succeeds.

## Validation

- v1.6.55 focused gate: 17/17
- v1.6.54 route-flow: 10/10
- v1.6.53 marketplace/actions: 16/16
- v1.6.52 media/edit: 18/18
- v1.6.50 selectable edit parity: 21/21
- v1.6.49 edit/activation: 22/22
- Dashboard completeness: 52/52
- Dashboard repository: 8/8
- Dashboard service coverage: 68/68
- Dashboard workflows: 22/22
- Bus forms: 45/45
- Staff/Driver: 51/51
- Partner ownership: 19/19
- Hotel operations: 27/27
- Production readiness: 76/76
- Final regression: 42/42
- Architecture/security, route security and CSRF: passed
- JavaScript syntax: 645/645
- EJS syntax: 131/131

A clean `npm ci` could not complete inside the artifact container because the container client aborted the install. No `node_modules` is shipped; run `npm ci` on the target machine before verification.
