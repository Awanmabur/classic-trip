# Dashboard booking preview and modal layout fixes

## Fixed

1. Manual/create booking routing
   - Employee manual booking now opens the existing listing preview route `/listings/:serviceType/:slug`, not `/book/:serviceType/:slug` and not a separate employee booking form.
   - Company manual booking now opens the existing listing preview route before checkout, so users can select seats/rooms/slots first.
   - Admin create booking now opens the existing listing preview route when a listing is available; otherwise it falls back to `/search`.
   - Customer trip booking now opens the listing preview route when an existing saved/booking listing is available; otherwise it falls back to `/search`.

2. Existing booking flow preserved
   - The preview page remains `src/views/pages/listing-details.ejs`.
   - The preview page already contains seat/room/slot selection and then sends the user to `/book/:serviceType/:slug` only after selection.
   - No new booking design was added.

3. Three-per-line modal detail layout
   - Updated all dashboard detail modal grids to show three fields per row on desktop:
     - Admin dashboard
     - Company dashboard
     - Employee dashboard
     - Customer dashboard
     - Promoter dashboard
   - Tablet/mobile responsive fallback remains intact.

4. PDF export behavior retained
   - Dashboard record export remains PDF/print-save-PDF based, not JSON download.

## Checks

- `npm run check` passed.
- EJS render checks passed for all five dashboards.
- `npm test -- --runInBand --detectOpenHandles` passed: 4 suites, 28 tests.
