# Classic Trip Implemented Architecture

**Date:** July 21, 2026

## Architecture decision

Classic Trip is a secure modular monolith. Domain boundaries share one deployment and MongoDB transaction boundary, while controllers, services, repositories, models, jobs, views, and role policies remain separated by responsibility. Microservices are deliberately deferred until operational scale requires independent deployment.

## Runtime guarantees

- MongoDB is the sole production system of record.
- Production cannot use the seeded memory adapter.
- Transactions require replica-set/mongos support and majority writes.
- All sensitive writes use repository/application-service boundaries.
- Tenant, role, account state, membership, permission, CSRF/webhook, validation, and rate-limit controls execute before mutations.
- Side effects use a transactional outbox where atomic delivery intent is required.

## Domain boundaries

### Identity
`User`, `Company`, `CompanyEmployee`, branches, policies, invitations, verification reviews, device sessions, login/security audits, and canonical access control.

### Transport
`Route`, `RouteStop`, `Vehicle.seatTemplate`, `TripSchedule`, `Seat`, schedule rules, assignments, incidents, trip status, manifests, and scans.

### Hotel
`HotelProperty`, `RoomType`, `RoomUnit`, `RoomNightInventory`, stay rules, holds, manifests, housekeeping, and stay lifecycle.

### Commerce
`Cart`, `CartCheckoutAttempt`, `BookingGroup`, `Booking`, operational `Passenger`, `InventoryHold`, `InventoryHoldItem`, `PaymentIntent`, `Payment`, receipt/tax records, and ticket legs.

### Finance
`Wallet`, `WalletTransaction`, `Commission`, `SettlementBatch`, `PayoutRequest`, `PayoutBatch`, `RefundRequest`, `ReconciliationReport`, `FinanceStatement`, and `FinanceRiskReview`.

### Support and communication
`SupportTicket`, `CorrespondenceMessage`, `BookingTimelineEvent`, `Notification`, `NotificationDeliveryAttempt`, `PushSubscription`, `OutboxEvent`, and templates.

### Growth
Promoter links, referral clicks, attribution sessions, campaign conversions, campaigns, offline sales, agent profiles, fraud signals, reviews, blogs, and saved listings.

## Intentional data distinctions

- `Vehicle.seatTemplate` is reusable static layout; `Seat` is schedule-specific mutable inventory.
- `Booking.passengers` is an immutable checkout snapshot; `Passenger` is an operational projection for manifests and check-in. The projection is uniquely keyed by booking and passenger index.
- `RouteStop` is canonical; routes no longer persist embedded stops.
- `RoomType`, `RoomUnit`, and `RoomNightInventory` replace the retired aggregate `Room` model.
- `PlatformSetting` is the settings singleton; the duplicate `Setting` model is retired.

## Role isolation

Super Admin remains the only role allowed under `/admin`. Support, finance, operations, and content administrators have separate route namespaces, report whitelists, data projections, permission guards, rate limits, and redirect roots. Company and employee routes enforce tenant scope; employee actions additionally require active membership and exact permissions. Driver, customer, and promoter routes expose only owned or assigned records.

## Dashboard composition

Every role has a separate entry view. The shared shell is composed from 58 focused EJS sections and external CSS/JavaScript. Data is projected on the server before serialization. Forms and dynamic actions resolve to role-specific namespaces. Frontend visibility is a usability feature; backend authorization is always authoritative.

## Release gates

- Syntax plus real Mongoose model loading
- Architecture and canonical-entity checks
- Route-security policy audit
- Dashboard scope and route smoke checks
- 21-point acceptance matrix
- Full integration/unit/e2e suite
- Dependency vulnerability audit
- Secret scan
- Production configuration validation
- Clean archive inspection
