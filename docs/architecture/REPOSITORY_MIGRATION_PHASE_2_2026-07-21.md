# Repository Migration Phase 2

Date: 2026-07-21

## Scope completed

This phase migrates the transport and hotel operational domains away from direct access to the legacy global store while preserving the existing controllers, dashboards, seeded demo mode, and external API contracts.

## Transport boundary

The following operations now run through `transportService` and `transportRepository`:

- Route creation, update, archive, and stop ordering
- Vehicle creation, update, status, and seat-layout templates
- Schedule creation, batch creation, publishing, duplication, completion, and status changes
- Recurring schedule rules, pausing, resuming, and horizon materialization
- Schedule seat generation and seat-state changes
- Driver assignment references used by transport operations

MongoDB-backed schedule creation commits the schedule and generated schedule-seat inventory in one transaction. A schedule requested as published is first persisted safely as a draft and is promoted only after route, vehicle, timing, inventory, and company verification checks succeed.

## Hotel boundary

The following operations now run through `hotelService` and `hotelRepository`:

- Hotel properties
- Room types and room units
- Room-night inventory
- Legacy room compatibility operations
- Room maps and hotel manifests
- Guest check-in and check-out
- Housekeeping state
- Standalone hotel booking and payment persistence
- Hotel booking settlement

MongoDB-backed hotel checkout atomically claims room nights and writes booking/payment records. Successful payment settlement is idempotent and creates the commission, platform/company wallet balances, optional promoter wallet balance, and wallet transactions once.

## Compatibility strategy

`HybridCollection` provides two modes:

1. MongoDB production mode, where repository writes are authoritative.
2. Seeded test/demo fallback, where the existing read model remains available.

After a successful MongoDB commit, the affected transport or hotel records are mirrored into the temporary dashboard read model. A failed MongoDB transaction never updates the mirror.

No transport domain service, hotel domain service, or recurring schedule materializer imports `persistentStore` or reads `store.state` directly.

## Service cleanup

The duplicate transport and room implementation block was removed from `companyService`. Existing controllers retain their public method calls, but those methods delegate to the new domain services, avoiding a simultaneous high-risk controller rewrite.

## Verification

- 37 test suites passed.
- 112 tests passed.
- Transport/hotel repository isolation tests passed.
- Schedule materialization tests passed.
- Hotel operations and settlement tests passed.
- Dashboard scope validation passed.
- Dashboard route static smoke validation passed.
- All 21 acceptance criteria passed.
- Production dependency audit found zero known vulnerabilities.

## Remaining repository migration

The compatibility store still supports older finance, support, promoter, customer, notification, reporting, and dashboard read-model paths. These domains should be migrated next, followed by legacy entity data reconciliation and final deletion of `persistentStore.js`.
