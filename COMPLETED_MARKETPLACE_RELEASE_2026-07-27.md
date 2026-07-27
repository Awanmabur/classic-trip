# Classic Trip Completed Marketplace Release — 27 July 2026

## Delivered

- Light mode is the first-run default on public, authentication and dashboard pages. A saved user preference still restores dark mode, and all theme controls continue to switch and persist the selection.
- The launch experience uses one branded flash containing the Classic Trip logo, name and slogan. It is session-scoped in the browser and suppressed for installed standalone mode to avoid a duplicate native/web splash.
- Mobile Profile opens a real navigation drawer with Home, every marketplace service, Saved, My bookings (`/booking`), Guides and the user dashboard/profile.
- Seven service types are active and bookable: bus, stay/Airbnb, flight, local taxi, tour, car rental and cargo.
- Tours use dated participant capacity and per-person reservations.
- Car rentals use vehicle availability, pickup/return dates, rental duration, locations and driver options.
- Cargo uses pickup/delivery locations, weight, package count, dimensions, recipient data and service-unit pricing.
- Airbnb-style homes use the canonical stay inventory and booking engine through a dedicated public discovery route and semantic stay-type filtering.
- Generic service checkout creates authoritative bookings, booking items, booking legs, passenger/customer rows, protected QR records and service reservation snapshots. Inventory is atomically reduced and released after failed payment or cancellation.
- Booking history, confirmations, public ticket pages, QR instructions and PDFs now preserve the correct document and fulfilment wording for every service.
- Partners can create promotions only for their own published services, then pause, resume or end campaigns from the partner dashboard.
- Super Admin and Content Admin blog operations support create, edit, publish, draft and archive, with published posts available on the public blog.

## Verification completed

- JavaScript syntax: 526/526 passed.
- EJS syntax: 127/127 passed.
- Seven-service completion contract: 38/38 passed.
- Branded single-splash contract: 7/7 passed.
- Final platform polish: 18/18 passed.
- Production finalization: 30/30 passed.
- Production readiness: 76/76 passed.
- Approved reference UI merge: 178/178 passed.
- Partner registration and identity: 9/9 passed.
- Dashboard service coverage: 68/68 passed.
- `git diff --check`: passed.

## Verification limitation

The dependency-backed Jest unit suite was not executed in this container because repeated clean `npm ci` attempts stalled while downloading dependencies. No `node_modules` directory is included in the release. Run the complete setup and `npm run verify` in an environment with normal npm registry access before production deployment.

## Local setup

```bash
cp .env.example .env
npm ci
npm run seed:superadmin
npm run check:seven-services
npm run verify
npm start
```

## Production release gate

```bash
npm ci --omit=dev
npm run db:indexes
npm run doctor
NODE_ENV=production npm run launch:check
npm run start:prod
```

Use real production MongoDB, payment, email/SMS, media, map/routing and supplier credentials. No responsible engineering process can guarantee permanent zero vulnerabilities; complete dependency scanning, sandbox transaction tests, DAST and an independent penetration test before accepting live money or sensitive customer data.
