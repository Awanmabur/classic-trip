# Classic Trip v1.6.53 — Marketplace Cards & Dashboard Actions Audit

## Scope

This release addresses the public bus-card duplication/layout request, cheapest-route pricing, service-card styling consistency outside the homepage, four-column blog directory, dashboard Quick Actions, archive lifecycle behavior, and the production/CSRF faults visible in the 2026-08-12 runtime log.

## Public marketplace corrections

- Bus cards no longer repeat the primary route above the complete route list.
- When the listing title already equals the operator/company name, the operator name is not printed a second time.
- Bus route chips form a three-row horizontal swipe matrix in card view and a two-row swipe matrix in homepage bar view.
- Route-chip typography is larger while preserving overflow-safe horizontal navigation.
- Bus prices render as `From <amount>` and the catalog chooses the cheapest full-route customer fare from the listing's route summaries rather than the cheapest stop segment.
- Server-rendered search/service cards now carry the same service identity classes as homepage cards.
- Bus, stays, flight, taxi, tour, car-rental and cargo card identities are applied on search and service landing pages.
- `/blogs` uses four equal cards per desktop row. The approved homepage stylesheet remains byte-for-byte unchanged; this directory-only override lives in `completion-fixes.css`.

## Dashboard action corrections

- Company Bus and Stay Quick Actions now navigate to the real operational page and use `?create=<type>` to open that page's complete Create form after its page-specific data has loaded.
- Generic company service Quick Actions now use the real Listings, Company Profile and Bookings pages instead of overview-only modal data.
- Schedule row actions are lifecycle-aware: Publish/repair only appear for draft/legacy-active departures, Complete only appears after arrival, and impossible archive actions are not offered for active-trip lifecycle states.
- Published/delayed departures can be archived when they have no active bookings, tickets, holds or seat assignments. Passenger activity blocks archival with a specific safety message.
- Archiving a recurring departure emits `BusDepartureArchived` and `ScheduleRuleMaterializationRequested`, keeping rolling supply repair connected.

## Runtime fixes derived from deployment log

- Fixed `ReferenceError: appUrl is not defined` in production environment validation by keeping the validated `APP_URL` object in scope for Pesapal callback/IPN host checks.
- Notification POST requests prefer the current `XSRF-TOKEN` cookie, reducing stale-meta CSRF failures after session/token rotation.

## Validation completed

- v1.6.53 marketplace/actions: 16/16
- v1.6.52 media/edit regression: 18/18
- v1.6.51 media/Cloudinary regression: 18/18
- v1.6.50 selectable Edit parity: 21/21
- v1.6.49 edit/activation integrity: 22/22
- Dashboard completeness: 52/52
- Dashboard service coverage: 68/68
- Dashboard workflow relationships: 22/22
- Bus form contracts: 45/45
- Production readiness: 76/76
- Final regression: 42/42
- Route security: passed
- Multipart CSRF: 44/44
- Browser CSRF synchronization: 4/4
- JavaScript syntax: 641/641
- EJS syntax: 131/131
- Release consistency: 11/11
- Lockfile integrity: 17/17 (217 package entries)

## Validation limitation

A fresh `npm ci` attempt in the artifact container failed at the container execution layer before npm returned a project-level result. The lockfile and dependency-free source gates passed. Run `npm ci` on the target machine/Render build as the installation check.
