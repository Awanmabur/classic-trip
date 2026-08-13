# Classic Trip — Production Platform

Classic Trip is the East Africa travel and mobility marketplace for buses, flights, stays, taxi/boda, tours, car rental and cargo.

## Current production release

**Version 1.6.65**

This release keeps the lightweight public-discovery performance architecture, resilient MongoDB/Redis runtime behavior, current booking/seat integrity rules, dashboard workflows, media handling and the approved marketplace card/bar UI. It also removes obsolete release-history clutter and fixes the duplicate Mongoose `vehicleId` index warning in `SeatMapTemplate`.

## Requirements

- Node.js 20+ (Render can use the version declared by the project)
- MongoDB Atlas or a compatible MongoDB deployment
- Redis for production sessions/cache/rate limits
- Docker Desktop is optional for local Redis

## Local setup

```bash
cp .env.example .env
npm ci
npm run redis:local
npm run doctor:network
npm run db:indexes -- --dry-run
npm run db:indexes
npm start
```

For development with watch mode:

```bash
npm run dev
```

## Production verification

Run the production-focused regression suite:

```bash
npm run verify
```

Run the complete release gate, including the production npm vulnerability audit:

```bash
npm run release:check
```

Focused operational checks:

```bash
npm run check:production-cleanup
npm run check:runtime-network
npm run check:public-performance
npm run check:index-reconciliation
npm run doctor:network
npm run doctor:media
```

## Runtime architecture

- MongoDB is authoritative for bookings, payments, seat inventory and transactional state.
- Redis accelerates sessions, rate limits and shared discovery/cache state; temporary Redis failures recover automatically and do not become the source of truth for bookings.
- Public Home/Search/catalog discovery uses the lightweight cached snapshot and does not bulk-load seat rows, room-night rows, room units or vehicle rows.
- Booking context uses scoped authoritative reads for the selected listing/departure.
- Web and worker processes remain separate production runtimes.

## Operational commands

```bash
npm run seed:superadmin
npm run seed:launch-content:dry
npm run seed:launch-content
# Controlled maintenance utilities are invoked directly by an operator only when needed:
node scripts/repair-rolling-rules.js
node scripts/repair-bus-launch-readiness.js
node scripts/repair-archive-uniqueness.js
npm run doctor:media:db
```

Maintenance scripts are intentionally retained because they are operational tools for existing databases; they are not dead release artifacts. `db:indexes` reconciles the physical Atlas indexes with the current Mongoose schema and can remove a legacy conflicting single-field index safely after a dry run.

## Security

Do not commit `.env`, credentials, seed-output credentials or private keys. Production requires HTTPS, secure session configuration, CSRF protection, authorization checks and validated payment/webhook handling. See `SECURITY.md` for the security baseline.
