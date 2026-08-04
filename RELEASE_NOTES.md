# Classic Trip 1.4.10 — Release Check and Compact Bar Correction

## v1.4.10 corrections

- Corrected the stale final-polish assertion so it verifies targeted selected-seat hold expiry instead of requiring the removed global checkout sweep.
- Desktop bar view no longer inherits a fixed card-like minimum height. Its row height now follows its actual title, metadata, description, price, and actions.
- Mobile bar sizing remains unchanged.


Release date: 4 August 2026

## Changes in this release

### Faster Proceed to payment

- Checkout preparation no longer loads full bus availability twice before creating the secure seat hold.
- The payment page reuses the marketplace snapshot already loaded for the request.
- Return-departure discovery is skipped on the payment page because the selected return journey is already stored in the secure draft.
- Hold-item identifiers are allocated in one MongoDB counter operation instead of one operation per seat segment.
- Compatibility seat records are recalculated in a single batched read/write path instead of repeated per-seat queries.
- Checkout no longer runs a global stale-hold sweep. Expired holds affecting the selected seats are released immediately, while the normal expiry job handles general cleanup.
- Existing draft reuse, double-click protection, inventory conflict checks and double-booking prevention remain active.

### Homepage cards

- Desktop card mode keeps exactly three fixed columns in every marketplace section.
- One or two listings remain in their normal column widths and do not stretch to fill the row.
- The phone Featured Buses rail still uses two rows, but now reveals about one quarter of the next card column instead of half a card.
- Decorative section color overrides added in the previous release were removed. The existing platform palette is used unchanged.

### Compact bar mode

- Bar images are wider on desktop and phones.
- Availability badges are placed in the top-right corner of the full bar.
- Bar content reserves space for the badge so it does not cover the title or description.
- Desktop descriptions use one line with ellipsis truncation.
- Bars remain one per row on phones and two per row on desktop.

### PWA caching

- The service-worker cache is `classic-trip-static-v1.4.10`.

## Verification

Run:

```bash
npm ci
npm run check:final-home-payment
npm run release:check
npm start
```
