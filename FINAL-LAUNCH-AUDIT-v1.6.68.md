# Classic Trip v1.6.68 — Production UI/Route Correction Audit

## Corrected in this release
- Blog preview restores the established desktop split header (copy left, image right) instead of the temporary full-width stacked hero.
- The blog header has no forced minimum height; its desktop height is defined by its text/content.
- Blog hero images are cropped inside the media column with absolute cover sizing, so unusually tall images cannot increase the header/card height.
- On tablet/phone the preview still stacks, with a bounded responsive media height so tall source images cannot break the design.
- Preview Partner / Share / Close controls stay pinned at the top-right opposite the service badge.
- Preview hero images are bounded to the approved visual height and cropped with `object-fit: cover`; tall source images cannot stretch the sheet.
- Remaining hazy/glass section backgrounds and shadows are removed from public marketing/search page wrappers while content cards remain distinct.
- Country-route filtering uses origin and destination terminal countries instead of city-slug corridors. Existing routes are resolved from terminal branch country data, with legacy city fallback for routes such as Juba ⇄ Kampala.
- New and edited bus routes persist `originCountry`, `destinationCountry`, and normalized `countryCorridor` metadata.
- `npm run release:check` accepts a legitimate local `.env` while verifying that `.env` remains git-ignored and `.env.example` ships. Release archives still exclude `.env`.

## Data compatibility
No database migration or reseed is required. Existing route records continue to work because public discovery derives country pairs from their referenced terminal branches.

## Validation
- Public layout/content: 18/18.
- Public performance: 18/18.
- Production cleanup: 17/17.
- Runtime/network: 15/15.
- Lockfile integrity: 17/17 (217 package entries).
- Release consistency: 11/11.
- Index reconciliation contract: 4/4.
- JavaScript syntax: 619/619.
- EJS templates were not modified in v1.6.68; the sandbox could not execute the dependency-backed EJS compiler command.
- Production architecture: 7087/7087.

The dependency graph is unchanged from the previous production release. The user's attached local run installed 217 packages and reported zero vulnerabilities. This sandbox did not rerun the registry-backed dependency audit or dependency-backed EJS compiler for v1.6.68; run `npm ci && npm run release:check` locally before deployment.
