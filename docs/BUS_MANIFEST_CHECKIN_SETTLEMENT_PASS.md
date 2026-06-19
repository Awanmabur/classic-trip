# Bus Manifest, Check-in, and Settlement Pass

This pass continues the Bus Company Admin end-to-end implementation while keeping the same shared Super Admin dashboard shell.

## Added / strengthened

- Company schedule manifests now have company-scoped routes:
  - `GET /company/schedules/:scheduleId/manifest`
  - `GET /company/schedules/:scheduleId/manifest.csv`
  - `GET /company/schedules/:scheduleId/manifest.xls`
  - `GET /company/schedules/:scheduleId/manifest.pdf`
- Company operational tickets now have a company-scoped route:
  - `GET /company/tickets/:bookingRef`
- Company seat-to-ticket lookup now has a company-scoped route:
  - `GET /company/seats/:scheduleId/:seatNumber/ticket`
- Schedule rows in the shared dashboard now expose:
  - open printable manifest
  - download manifest PDF
  - download manifest CSV
  - publish schedule
  - update trip status
  - complete trip and release eligible checked-in earnings
  - duplicate schedule
  - archive schedule
- Booking/check-in rows now expose:
  - open operational ticket detail
  - manual check-in
  - mark no-show
- Added schedule completion action:
  - `POST /company/schedules/:id/complete`
- Schedule completion now:
  - marks the schedule completed
  - writes a trip status update
  - releases pending company/promoter earnings for eligible checked-in bookings
  - writes audit history
  - persists schedule, trip status update, bookings, commissions, wallets, and wallet transactions when MongoDB is connected

## Important behavior

- A schedule completion does not blindly release every paid booking.
- Only bookings already checked in or completed are eligible for earning release.
- No-show, cancelled, refunded, unpaid, and unconfirmed bookings remain unreleased.

## Validation

Updated `scripts/validate-dashboard-scope.js` to verify the new manifest, ticket, check-in, no-show, and schedule-completion actions remain wired.

Passing checks:

```bash
npm run check
npm run check:dashboards
```

Live Express rendering was not executed in this environment because dependencies such as `express` are not installed in the extracted folder. Run `npm install` locally before starting the app or Jest.
