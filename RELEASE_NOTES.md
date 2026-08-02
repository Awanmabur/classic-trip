# Classic Trip 1.4.3 — Final Release Maintenance

Release date: 2 August 2026

This maintenance release fixes the two issues discovered during the final installation on the live Atlas database while preserving the MongoDB resilience, performance, reverse-trip, booking-state, and security work from 1.4.1.

## Fixes in 1.4.3

- Fixed `check:release-cleanup` on Windows/Node 24 by executing npm through `npm-cli.js` instead of spawning `npm.cmd`.
- Replaced Nodemon with Node's built-in watch mode, removing the remaining external development watcher dependency tree.

- `npm run db:indexes` now performs controlled index reconciliation instead of calling `Model.createIndexes()` blindly.
- Legacy single-field Listing and Airport text indexes are replaced by one canonical compound search index per collection.
- The BlogPost external ID index is safely upgraded from a legacy non-unique index to a sparse unique index.
- Unique-index upgrades run a duplicate-data preflight and stop with exact duplicate examples instead of dropping an index and failing later.
- Existing equivalent indexes are accepted even when an older deployment used a different index name.
- The index command supports `--dry-run` for production review before applying changes.
- The release cleanup checker now inspects the actual `npm pack --dry-run` file list. A required local `.env` and installed `node_modules` no longer cause false failures, while secrets and dependencies are still verified as excluded from release packaging.
- The service-worker cache is versioned as `classic-trip-static-v1.4.3`.
- Jest 29 and unused Supertest were removed. Unit tests now use Node's built-in test runner, eliminating the deprecated `inflight` and `glob@7` development chain and reducing the lockfile substantially.

## Consolidated platform fixes

- Process-wide MongoDB read concurrency control prevents dashboard and marketplace requests from exhausting the pool.
- MongoDB startup retries and safe read retries cover short Atlas topology and pool interruptions without retrying unsafe writes.
- Reverse trips use reversed branch/location identity rather than unrelated stop-record IDs.
- Valid return departures are independent of the outbound clock time.
- Published future bus departures with inventory are the source of truth for bus bookability.
- Unsafe redirect targets are restricted to local application paths.
- Multipart uploads use bounded file, field, part, and header limits.

## Release commands

```bash
npm ci
npm run db:indexes -- --dry-run
npm run db:indexes
npm run release:check
npm run release:launch
npm start
```

`release:check` runs the complete source/runtime/unit verification followed by a high-severity production dependency audit. The external development watcher dependency tree has been removed. The remaining `jpeg-exif` installation message comes from PDFKit 0.15.2 and is a deprecation warning; the live npm audit result remains the release authority.
