# Classic Trip v1.6.65 — Production Cleanup Final

## Fixed

- Removed the duplicate Mongoose index declaration on `SeatMapTemplate.vehicleId` while preserving the stronger unique partial index used for active/draft seat templates.
- Kept Redis automatic recovery after transient `ECONNRESET` events and the existing MongoDB fallback behavior.
- Kept the lightweight public-discovery performance architecture for Home, Search and public marketplace pages.

## Repository cleanup

- Removed all superseded `FINAL-LAUNCH-AUDIT-v1.6.x.md` history files and replaced them with one current production audit.
- Removed all version-numbered `check-v*.js` regression scripts and version-numbered npm check aliases.
- Replaced the latest performance/runtime version checks with stable commands: `check:public-performance` and `check:runtime-network`.
- Removed the obsolete `verify:legacy` chain.
- Simplified `verify` to the current production-critical regression suite.
- Removed `repair:*` npm aliases from the production command surface; maintenance utilities remain explicit operator-only scripts.
- Removed one confirmed unused legacy SVG asset.
- Removed stale CSS/JS release-label comments while keeping the actual behavior.
- Verified that no zero-byte files, empty directories, backup/temp/editor residue files or unreferenced package dependencies remain.

## Database and dependencies

- No data migration or reseed is required. Run `npm run db:indexes -- --dry-run` and then `npm run db:indexes` once to reconcile any legacy physical index left in Atlas.
- No dependency versions were changed from v1.6.64.
