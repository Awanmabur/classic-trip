# Classic Trip Final Bus and Hotel UI Organization Report

Date: 2026-07-24

## Scope

This release concludes the bus and hotel stage before flight and local taxi implementation. It preserves the approved Classic Trip visual language while reorganizing existing features and completing consistency fixes across dashboards and public marketplace pages.

## Hotel workspace organization

The previous repeated action/stat/tab layout was replaced with one connected operational structure:

1. Public hotel listing
2. Property profile
3. Room type
4. Rate plan
5. Physical room units
6. Dated room inventory

The Hotel Setup Journey displays readiness and record counts in dependency order. Daily operations are separate from setup and link directly to arrivals, in-house stays, departures, housekeeping, and maintenance.

Each hotel tab now owns its contextual action and filters:

- Properties
- Room types
- Rate plans
- Room units
- Calendar / dated room inventory
- Housekeeping and maintenance

Tables and the room visual map use a full-width layout instead of competing narrow columns. Optional hotel extras remain a separate connected section.

## Dashboard consistency

- The Classic Trip brand at the top of every shared dashboard links to the public home page.
- The reusable legacy dashboard sidebar partial uses the same home link for future-safe consistency.
- Warning and information notices have consistent space from surrounding card edges.
- Empty table rows use a complete rounded surface in both dark and light themes.
- Empty-state text remains readable and is no longer presented on a sharp rectangular background.
- Hotel counts distinguish open housekeeping work, cleaning work, and maintenance blocks rather than counting completed history as active work.

## Marketplace card consistency

Home, Search, Services, Company Profile, and Promoter marketplace pages use one shared server-rendered listing-card partial. Dynamic Home rendering mirrors the same structure and wording.

All marketplace listing cards now keep consistent proportions, content spacing, price placement, media presentation, actions, availability badge, partner identity, route/location, and bus/hotel price hints.

## Preserved completed architecture

This UI organization pass preserves the concluded bus and hotel architecture, including:

- Commission-only partner model
- Direct partner signup and verification-controlled activation
- Segment-aware bus fares and seat inventory
- Versioned vehicle seat maps
- Dated bus departures
- Round-trip booking legs
- Canonical bus reservations, passengers, assignments, tickets, manifests, QR check-in, cancellation, refund, and settlement flows
- Normalized hotel properties, room types, rate plans, units, room nights, reservations, guests, room assignments, vouchers, manifests, arrivals, in-house, departures, no-shows, housekeeping, maintenance, cancellation, refund, and fulfillment-based settlement
- Server-side pricing, payment verification, tenant isolation, permissions, CSRF, audit history, and idempotency controls

## Runtime checks still required in a connected environment

The archive intentionally excludes `node_modules`. After extraction:

```bash
npm ci
npm run migrate:commission-only:dry
npm run migrate:hotel-domain:dry
npm run verify
NODE_ENV=production npm run launch:check
```

Back up MongoDB before applying either migration.
