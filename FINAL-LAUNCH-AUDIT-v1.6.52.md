# Classic Trip v1.6.52 Final Repair Audit

## User-reported evidence addressed

The supplied `doctor:media:db` output showed all seven seeded blogs and all six seeded bus listings still pointing at external HTTPS hotlinks while `migrate:seeded-media` reported them as `customPreserved`. That made the migration skip the exact records that needed repair. The supplied seed output also showed an `E11000` duplicate-key failure for `route-seed-zawadi-travel-service-kampala-adjumani`. The user also reported that Create relationship selects were selectable but the same fields were locked in Edit.

## Media repair

- Added an explicit registry of the known legacy seed blog/operator URLs.
- Blog image resolution maps those legacy seed URLs to `/media/blog/:slug` immediately.
- Bus listing marketplace resolution maps known seeded operator hotlinks to `/media/operator/:key` immediately.
- Cloudinary migration treats those exact legacy seed URLs as migratable instead of custom.
- Genuinely custom URLs/uploads remain protected.
- Seeded blog and operator media files remain physically bundled.
- Stable media routes use `no-cache, no-store` and are not service-worker precached.
- Cloudinary remains the persistent upload target when configured.

## Seed idempotence

`seed:launch-content` now checks canonical `id` before its looser semantic lookup. If a concurrent/legacy state still produces `E11000`, it re-reads the canonical seeded record rather than terminating the whole seed. This directly addresses the duplicate Zawadi seeded-route failure.

## Create/Edit selector parity

The shared dashboard renderer no longer turns Edit relationships into disabled selects plus hidden mirrors. Existing values remain selected, including legacy/inactive current selections, but the user can choose another valid option exactly as in Create.

Validated relationship changes are persisted for:

- Bus Route → Bus listing
- Vehicle → Bus listing
- Fare Plan → Route
- Seat Template → Vehicle
- Staff/Driver relationship selections already covered by their workflow services
- Stay Property → Stay listing
- Room Type → Property/listing
- Room Unit → Room Type
- Rate Plan → Room Type
- Room-night → Room Type/Room Unit/Rate Plan

The backend still protects integrity. A selector is not disabled merely because a move can be risky; instead, the submitted change is ownership-validated and is rejected only when committed live dependencies make the move unsafe.

## Validation completed in the release worktree

- v1.6.52 media + selectable edit repair: 18/18
- v1.6.51 media/Cloudinary/PDFKit regression: 18/18
- v1.6.50+ selectable edit-form parity: 21/21
- v1.6.49+ edit/activation integrity: 22/22
- v1.6.48 runtime isolation: 11/11
- v1.6.47 rolling/blog media: 19/19
- v1.6.45 blog images: 8/8
- v1.6.44 homepage/blog/bus/departures: 16/16
- v1.6.43 blog/partner accounts: 13/13
- JavaScript syntax: 640/640
- EJS dependency-free syntax: 131/131
- Bus form contracts: 45/45
- Dashboard completeness: 52/52
- Dashboard service coverage: 68/68
- Staff/Driver workflow: 51/51
- Partner ownership: 19/19
- Hotel operations: 27/27
- Dashboard workflow relationships: 22/22
- Dashboard repository readiness: 8/8
- System completion: 162/162
- Production readiness: 76/76
- Final regression: 42/42
- Lockfile integrity: 17/17
- Release consistency: 11/11
- Route security passed
- Multipart CSRF: 44/44
- Browser CSRF: 4/4
- Architecture/security passed

## Runtime-validation limitation

This artifact container could not execute `npm ci`; the container runtime returned a ClientError before dependency installation. Therefore dependency-backed runtime/unit tests were not falsely reported as executed here. The lockfile integrity gate passes, and the user's Windows environment successfully installed the same dependency generation in v1.6.51. Run `npm ci` and `npm run verify` on the actual project/deployment before production launch.

## Existing Atlas data commands

After replacing the project:

```bash
npm ci
npm run check:v1652-media-edit-repair
npm run seed:launch-content
npm run migrate:seeded-media:dry
npm run migrate:seeded-media
npm run doctor:media:db
npm start
```

Expected migration behavior for the database state shown in the supplied log: the seven known blog hotlinks and six known seeded bus/operator hotlinks should move from `pending` in dry-run to `migrated` on apply (unless a row has since been replaced with a genuine custom or Cloudinary image).
