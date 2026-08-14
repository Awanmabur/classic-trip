**v1.6.75 launch-security final:** all 20 supplied launch security controls are now implemented or mapped to the correct Classic Trip equivalent and enforced by automated gates. New sensitive-field writes use a dedicated AES-256-GCM `DATA_ENCRYPTION_KEY`; legacy v1 encrypted values remain readable with the existing `SESSION_SECRET`. Secret-history scanning, bot-proof/honeypot protection, daily login throttling, protected-field tampering rejection, API redaction, strict-query enforcement plus app-wide Mongo operator-key rejection, hardened script JSON escaping, upload validation, modern headers, HTTPS/TLS enforcement and production dependency auditing are included.

# Classic Trip — Production Platform

**v1.6.72 final media correction:** seeded Stay listings now use verified real hotel media rather than generic profile covers wherever a public hotel/property photo can be verified. Dandy's verified public hotel image is bundled locally; Zoom Future, Vision Gate and Kal resolve their specific public hotel photo pages during the Stay seed and copy the resolved image into Cloudinary when configured. Pyramid and Radisson retain verified property images. The Daddy→Dandy migration remains in place and does not create a duplicate Stay.

Classic Trip is the East Africa travel and mobility marketplace for buses, flights, stays, taxi/boda, tours, car rental and cargo.

## Current production release

**Version 1.6.75**

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
## v1.6.75 Go-live commands

The v1.6.72 launch release adds six conservative Stay partner profiles and production Pesapal readiness checks. Stay profiles are public but remain non-bookable until genuine room/rate/date inventory is configured.

```bash
npm ci
npm run redis:local
npm run doctor:network
npm run doctor:pesapal
npm run check:go-live
npm run release:check
npm run seed:launch-stays:dry
npm run seed:launch-stays
npm start
```

See `FINAL_RELEASE_CHECKLIST.md` before production traffic is enabled.
