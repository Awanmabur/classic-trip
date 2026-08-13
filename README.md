# Classic Trip — Production Platform

Classic Trip is the East Africa travel and mobility marketplace for buses, flights, stays, taxi/boda, tours, car rental and cargo.

## Current production release

**Version 1.6.68**

This release preserves the cleaned v1.6.65 production baseline and the v1.6.63+ lightweight public-discovery architecture while completing the public marketplace layout: six-card Card view, four-item Bar view, real country-route filtering, vehicle-derived bus amenities, one shared public footer, cleaner marketplace surfaces and a corrected blog-preview layout.

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

Focused checks for this release:

```bash
npm run check:public-layout-content
npm run check:public-performance
npm run check:production-cleanup
npm run check:runtime-network
npm run check:index-reconciliation
npm run doctor:network
```

## Public marketplace behavior

- Home Card view starts at **6 items per service section**; Bar view starts at **4**.
- More actions appear at the bottom-right and expand using the active view's own increment.
- Country-route filters work on any route published under a bus listing and normalize reverse country pairs.
- Public bus amenities are the de-duplicated amenities of vehicles assigned to live departures.
- Public discovery remains lightweight: it does not bulk-read seat rows, room units or room-night inventory; vehicle reads are restricted to a small amenity projection for assigned vehicles.
- Booking, payment and seat availability continue to use scoped authoritative live reads.

## Shared footer and social profiles

All normal public pages and Home use one canonical footer layout. WhatsApp, email and phone actions are available from the configured support contacts. Official social profiles can be enabled by setting any of:

```env
SOCIAL_FACEBOOK_URL=
SOCIAL_INSTAGRAM_URL=
SOCIAL_X_URL=
SOCIAL_TIKTOK_URL=
SOCIAL_YOUTUBE_URL=
SOCIAL_LINKEDIN_URL=
```

Blank social values are not rendered as fake links.

## Runtime architecture

- MongoDB is authoritative for bookings, payments, seat inventory and transactional state.
- Redis accelerates sessions, rate limits and shared discovery/cache state; temporary Redis failures recover automatically and do not become the source of truth for bookings.
- Public Home/Search/catalog discovery uses the lightweight cached snapshot.
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
