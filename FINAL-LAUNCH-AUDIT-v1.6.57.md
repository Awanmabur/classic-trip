# Classic Trip v1.6.57 — Price and Amenity Flow Audit

## User-visible correction

- Restored the full bus price presentation: `From`, currency, amount, `Cheapest route fare`, View and Book actions.
- `From` and the currency are only slightly smaller than the main amount; they remain clearly readable.
- Amenities now use the same free-flow idea as routes: two independent horizontal lanes, natural-width chips, balanced placement, and native left/right swipe.
- Amenity labels are not squeezed, truncated, or forced into shared grid columns.
- Existing v1.6.56 behavior remains: two route lanes, descriptions removed, natural equal-height card rows, and bar images do not define bar height.

## Validation

- v1.6.57 price/amenities: 12/12 passed.
- v1.6.56 card rhythm regression: 10/10 passed.
- v1.6.53 marketplace/actions regression: 16/16 passed.
- v1.6.54 route-flow regression: 10/10 passed.
- release consistency: 11/11 passed.
- lockfile integrity: 17/17 passed, 217 package entries.
- JavaScript syntax: 624 files passed with `node --check`.
- EJS delimiter balance: 131/131 templates passed.

A fresh `npm ci` could not complete inside the artifact container because the container client aborted the command. The release contains no `node_modules`; run `npm ci` normally on the deployment/workstation.
