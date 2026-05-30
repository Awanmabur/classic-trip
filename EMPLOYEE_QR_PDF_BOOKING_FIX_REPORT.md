# Employee QR / PDF / Booking Flow Fix Report

This patch fixes the specific issues reported after the previous package.

## Fixed

1. QR camera did not open
   - Removed the dashboard dependency on remote `html5-qrcode` CDN loading.
   - Added a local scanner script: `public/js/employee-qr-scanner.js`.
   - The scanner now calls `navigator.mediaDevices.getUserMedia()` directly when the user presses **Open QR scanner**.
   - The camera preview is rendered inside the existing Ticket Check-in panel.
   - If the browser supports `BarcodeDetector`, QR codes are decoded automatically.
   - If the browser does not support QR decoding, the camera still opens and the UI shows that manual paste may be needed.
   - Clear errors are shown for HTTPS/localhost, blocked permissions, missing camera API, or unavailable camera.

2. Export should be PDF, not JSON
   - Employee row export buttons now say/export PDF instead of JSON.
   - The detail modal footer now has **Export PDF** instead of **Copy JSON**.
   - PDF export opens a print/save-PDF view using the same grouped details from the modal.
   - Also replaced row JSON export handlers in admin, company, customer, and promoter dashboards with print/save-PDF export.

3. Manual booking should open the existing booking page
   - Removed the separate manual-booking modal logic from employee quick actions.
   - The **Manual booking** quick card and **Create booking** button now navigate to the existing public booking page using the first active bookable company listing.
   - The target route is `/book/:serviceType/:slug`, matching the existing booking-form route.
   - If no active listing is available, it falls back to `/search`.

4. Existing design preserved
   - No new dashboard design was created.
   - Changes were made inside the existing employee dashboard structure and styling.

## Files changed

- `src/views/dashboards/employee/index.ejs`
- `src/views/dashboards/admin/index.ejs`
- `src/views/dashboards/company/index.ejs`
- `src/views/dashboards/customer/index.ejs`
- `src/views/dashboards/promoter/index.ejs`
- `src/services/data/demoStore.js`
- `public/js/employee-qr-scanner.js`

## Verification

- `npm install` completed.
- `npm run check` passed.
- Inline JavaScript syntax checks passed for all dashboard pages.
- EJS render checks passed for admin, company, employee, customer, and promoter dashboards.
- `npm test -- --runInBand --detectOpenHandles` passed: 4 suites, 28 tests.

## Browser note

Camera access only works on `https://...` or `localhost` / `127.0.0.1`. Browser camera permissions must also be allowed. If a browser has no built-in QR decoder, the camera preview opens but automatic QR decoding may require Chrome/Edge with `BarcodeDetector` support or a bundled decoder package.
