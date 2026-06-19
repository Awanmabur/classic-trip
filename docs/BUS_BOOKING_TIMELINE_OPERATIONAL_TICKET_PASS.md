# Bus Booking Timeline and Operational Ticket Pass

This pass connects the bus customer booking lifecycle more tightly into the company operations dashboard.

## Implemented

- Booking creation now writes booking timeline events.
- Inventory claim/seat or room assignment now writes a timeline event.
- Payment success, payment pending, and payment failure now write timeline events.
- Ticket issuance now writes a timeline event.
- Manual check-in / QR validation writes a ticket timeline event.
- Failed scans write an internal timeline event.
- No-show marking writes a ticket timeline event.
- Trip completion writes timeline events for completed eligible bookings.
- Operational ticket detail pages now load and display the booking timeline.
- Dashboard scope validation now checks that booking/ticket/check-in/no-show/timeline integration is present.

## Files changed

- `src/services/booking/bookingService.js`
- `src/services/company/companyService.js`
- `src/services/operations/manifestService.js`
- `src/views/pages/driver-ticket-detail.ejs`
- `scripts/validate-dashboard-scope.js`

## Operational result

A bus booking now connects to the operational truth expected by the blueprint:

`Booking -> Inventory claim -> Payment -> Ticket/QR -> Manifest -> Check-in/no-show -> Trip completion -> Settlement/release -> Timeline`

The company staff/driver ticket detail view can now show not only booking/payment/passenger data, but also the timeline of events that explains what happened to the ticket.

## Checks

- `npm run check`
- `npm run check:dashboards`
