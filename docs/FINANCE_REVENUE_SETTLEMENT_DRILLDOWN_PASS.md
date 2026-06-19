# Finance Revenue + Settlement Drilldown Pass

This pass adds a stronger shared finance layer for bus and hotel company dashboards.

## Added

- Revenue drilldown summary for company dashboards.
- Booking-level revenue ledger for bus and hotel bookings.
- Gross, company earning, platform fee, promoter commission, refund debit, and net payable columns.
- Settlement status visibility per booking.
- Settlement batch table with period, gross, payable, row count, and status.
- Wallet / settlement ledger table for company wallet transactions.
- Payout request table with payout method, account, batch, risk, and status.
- Finance statement table with export links.
- CSV export aliases for:
  - `revenueDrilldown`
  - `settlementBatches`
  - `settlementLedger`
  - `financeStatements`
- Static smoke validation markers for the new finance tables.

## Dashboard pages touched

- `/company/revenue`
- `/company/settlement`

## Compatibility

Existing `payouts` data is retained as an alias to the new revenue drilldown rows, so older dashboard render paths still work.

## Checks

- `npm run check`
- `npm run check:dashboards`
- `npm run check:dashboard-smoke-static`
