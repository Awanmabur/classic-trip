# Classic Trip — Final Bus and Hotel Platform

Production-oriented Node.js, Express and MongoDB marketplace for **bus travel and hotel stays**. The current release exposes only service types completed end to end: `bus` and `hotel`.

The existing visual design is preserved across public pages, authentication, partner dashboards, employee dashboards and operational documents. Shared components, spacing, forms, tables, tabs and action patterns are reused rather than duplicated.

## Requirements

- Node.js 20+
- npm 10+
- MongoDB Atlas or a replica set with transactions enabled
- Cloudinary or another configured production media adapter
- At least one configured payment provider before accepting live payments
- Email/SMS/push credentials for real notification delivery

Production refuses transaction-sensitive flows when MongoDB transaction support is unavailable.

## Initial setup

```bash
cp .env.example .env
npm ci
npm run seed:superadmin
npm run verify
npm start
```

Use strong independent secrets for sessions, MFA encryption, payment webhooks and the Super Admin. Do not commit `.env`.

## Unified authentication and onboarding

There is one rendered authentication/onboarding page:

- Login
- Customer signup
- Promoter signup
- Partner/company-owner onboarding
- Password recovery
- Email verification
- Phone verification
- MFA screens when enabled

`GET /partner/onboarding` is only a compatibility redirect into the Partner panel on the shared page. `POST /partner/onboarding` remains the one secure partner/company provisioning service.

Role rules:

- Customers, promoters and new company owners may self-register.
- Company staff and drivers are invitation-only.
- Platform administrators are invitation-only and MFA-governed.
- Super Admin is created or updated only through the supported bootstrap command.
- Pending partners may enter a restricted onboarding workspace but cannot publish, operate live bookings, collect operational payments or request payouts until verified.


## Partner commission model

Partner companies do not purchase a platform package. Any eligible bus or hotel company may create an owner account and enter the restricted verification workspace immediately.

The commercial flow is:

```text
Customer booking total
  -> one partner commission percentage retained by Classic Trip
  -> partner receives the remainder
  -> when a promoter referred the booking, the promoter reward comes from Classic Trip's commission
```

- The default percentage is managed in **Super Admin → Platform Settings**.
- Super Admin may set a partner-specific percentage from **Partners / Companies**.
- A company accepts its percentage contract during onboarding.
- Every bus or hotel booking stores an immutable contract and split snapshot.
- Later percentage changes affect only new bookings.
- Verification, not a payment package, controls publishing, operational payments and payouts.
- There are no partner renewals, recurring charges or commercial feature tiers.

The fresh-install default is 10% commission. Promoters receive 30% of Classic Trip's commission on an eligible referral, producing the former 90% partner / 7% platform net / 3% promoter result without charging the partner twice. Super Admin can change both percentages.

## Canonical bus architecture

```text
Company
  -> Branch / terminal
  -> Public bus listing
  -> Compliant vehicle
  -> Published versioned seat map
  -> Route
      -> Ordered stops
      -> Generated route segments
  -> Fare product
      -> Segment fares
  -> Dated departure
      -> Frozen route / seat-map / fare snapshots
      -> Verified operational driver assignment
      -> Seat-segment inventory
  -> Inventory hold
  -> Booking and booking item
  -> Bus reservation
  -> Passenger
  -> Seat assignment
  -> Ticket / QR
  -> Payment
  -> Manifest / check-in / no-show
  -> Cancellation / refund / settlement
```

A bus departure cannot be published unless linked records belong to the same company and listing and publication readiness passes. Driver assignment requires a real driver account, accepted invitation, active company membership, required verification/safety state and operational permissions. A job title or legacy permission label cannot substitute for a driver identity.

Seat availability is authoritative per seat and overlapping route segment. Return travel creates independent outbound and return reservations, inventory claims and tickets inside one customer booking.

## Canonical hotel architecture

```text
Company
  -> Public hotel listing
  -> Hotel property
  -> Room type
      -> Occupancy and bed rules
      -> Rate plan and cancellation policy
  -> Physical room unit
  -> Explicit dated room-night inventory
  -> Booking and booking item
  -> Hotel reservation
  -> Named hotel guests
  -> Room assignments
  -> Payment
  -> Operational voucher
  -> Arrival / check-in
  -> In-house stay
  -> Check-out
  -> Housekeeping task
  -> Settlement eligibility
  -> Cancellation / no-show / refund review
```

Hotel rules:

- One canonical property per company listing.
- Internal relationships use selectors; staff do not type foreign IDs.
- Room types define adult, child and infant limits.
- Every declared traveler must have a named guest record.
- Sellable room-night inventory must be deliberately configured; checkout never manufactures missing inventory.
- A physical room must be available and housekeeping-ready before sale.
- Pricing is recalculated server-side from room nights, hotel rate plans, occupancy surcharges, property taxes, service fees, add-ons and the partner commission contract.
- Only the completed `pay_now` flow is exposed. Security/incidental policies do not act as booking-payment deposits.
- Payment confirms the reservation but keeps settlement `pending_fulfillment`.
- Check-out creates housekeeping work and changes earnings to `eligible`; payment alone never settles a hotel stay.
- Hotel cancellation evaluates the immutable booked rate policy. Non-refundable, missing-policy or penalty-window cases go to finance review instead of receiving an unsafe automatic full refund.
- Hotel no-show is transactional: reservation, guests, assignments and booking items are updated, safe room nights are released and finance reconciliation is required.

## Hotel operations UI

The Partner/Employee dashboard uses the same shared design for:

- Properties
- Room types
- Rate plans
- Room units
- Room calendar and inventory
- Housekeeping
- Arrivals
- In-house guests
- Departures
- Manifests and history/no-shows
- Operational vouchers and PDF vouchers

Hotel manifests can cover one selected listing/property or the company’s complete hotel portfolio. They include guest identity masking, nationality, contact, emergency contact, occupancy, assigned rooms, payment, actual arrival/departure times, special requests and stay status.

## Payments and finance

- Prices and totals are never trusted from the browser.
- Provider callbacks/webhooks must be verified and idempotent.
- Booking status, payment status, fulfillment status and settlement status remain separate.
- Financial corrections use auditable refund/ledger workflows.
- Hotel payment success creates pending earnings; fulfillment controls eligibility.
- Payout requests and approvals remain separate from booking fulfillment.

## Security baseline

- CSRF protection, including multipart uploads
- Same-origin checks before multipart parsing
- Server-side authentication and authorization
- Tenant/company isolation
- Service-type and resource-ownership checks
- Permission-scoped employee operations
- Signed invitation lifecycle
- Rate limiting on sensitive routes
- Password hashing and bounded password input
- Session rotation and revocation
- Audit/timeline records for sensitive actions
- File validation, scanning adapter and private media workflow
- No raw payment secrets in application data
- Idempotency for booking, payment, refund and operational transitions

No software can honestly be guaranteed permanently vulnerability-proof. Production release still requires dependency-backed tests, current vulnerability scanning, provider sandbox certification, concurrency testing and penetration testing.

## Existing-database migration

Back up the database first. Run the commercial migration before the hotel-domain migration.

```bash
npm run migrate:commission-only:dry
npm run migrate:commission-only
npm run migrate:hotel-domain:dry
npm run migrate:hotel-domain
```

The commission migration removes retired partner billing fields and collections, creates one percentage contract for every company and preserves the previous effective split. The hotel migration normalizes legacy hotel bookings and setup records, consolidates duplicate properties safely and rewires dependent room/rate/inventory/reservation records. Inspect dry-run output before applying.

## Verification commands

```bash
npm run check
npm run check:runtime
npm run check:production
npm run check:bus
npm run check:bus-forms
npm run check:smart-bus-forms
npm run check:smart-publish
npm run check:driver-assignment
npm run check:driver-ui
npm run check:driver-materialization
npm run check:staff-driver
npm run check:partner-ownership
npm run check:architecture-security
npm run check:routes
npm run check:csrf
npm run check:entity-relations
npm run check:partner-registration
npm run check:commission-only
npm run check:dashboard-repository
npm run check:dashboards
npm run check:addons-return-seats
npm run check:stop-pricing-ui
npm run check:end-to-end-final
npm run check:bus-hotel-final
npm run check:bus-hotel-conclusion
npm run check:hotel-operations-final
npm run check:final-regression
npm test
```

`npm run verify` executes the complete installed-dependency release suite.

## Production release checklist

Before deployment:

```bash
npm ci
npm run verify
NODE_ENV=production npm run launch:check
```

Also verify:

- MongoDB transactions and restore-tested backups
- HTTPS and trusted proxy settings
- Correct public `APP_URL` and `SITE_URL`
- Cloudinary/media credentials
- Payment provider callbacks and webhook signatures
- Email/SMS/push delivery
- Scheduled jobs enabled in exactly one worker/process
- Super Admin MFA enabled when operationally ready
- Current `npm audit`/dependency review
- Real concurrent final-seat and final-room tests
- Payment failure, retry, refund and reconciliation tests
- Provider sandbox certification and penetration testing

## Final bus and hotel UI organization

The hotel workspace now follows one ordered setup journey from public listing through dated inventory, with daily hotel operations separated from setup. Dashboard brand links return to the marketplace, notices and empty table states use consistent spacing and rounded surfaces, and all public marketplace listing pages share one card implementation. See `FINAL_BUS_HOTEL_UI_ORGANIZATION_REPORT_2026-07-24.md`.
