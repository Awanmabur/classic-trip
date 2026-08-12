# Classic Trip v1.6.56 — Marketplace Card/Bar Rhythm Audit

## Scope
This release is presentation-only. It changes the shared marketplace listing renderer used on Home, Search, service landing pages, company profile and promoters pages. It does not change booking, payment, dashboard, publication or database logic.

## Implemented
- Bus routes use two independent horizontally swipeable lanes on cards and bars.
- Route typography is smaller and lighter than v1.6.55 while preserving full-width route labels.
- Amenities render in two reserved horizontally scrollable lanes.
- Empty route/amenity slots preserve the same content rhythm instead of shrinking shorter listings.
- Marketplace descriptions are removed from cards/bars.
- `From` and currency are de-emphasised while the numeric fare remains the primary price.
- Home bar images fill the content-defined row and no longer set the bar height.
- Cards in marketplace grids stretch naturally to the tallest card in their grid row; no single fixed card height is introduced.
- Search/service-page cards use the same shared structure.
- Service-worker and semantic browser assets are cache-busted to v1.6.56.

## Validation
- 10/10 v1.6.56 card-rhythm checks
- 10/10 route-flow regression checks
- 16/16 marketplace/actions regression checks
- 52/52 dashboard completeness
- 68/68 dashboard service coverage
- 76/76 production readiness
- 42/42 final regression
- 646/646 JavaScript syntax
- 131/131 EJS syntax
- 11/11 release consistency

## Database
No migration, reseed or repair command is required for v1.6.56.
