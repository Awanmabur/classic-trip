# Classic Trip dashboard line-by-line implementation pass

Base used: `/mnt/data/fixwork` corrected project. I did not create a replacement dashboard design. I kept the existing EJS dashboard layouts and enriched the real data/rendering layer inside the same pages.

## Prompt checklist progress

### Project inspection
- Read the uploaded prompt from `Pasted text(8).txt`.
- Confirmed the real project structure is `src/views/dashboards/*`, `src/controllers/*`, `src/routes/*`, and `src/services/data/demoStore.js`, not the older path names in the prompt.
- Confirmed dashboards use EJS + embedded vanilla JavaScript and the in-memory/Mongo-hydrated data store.

### A. Super Admin Dashboard — implemented in this pass
Files changed:
- `src/services/data/demoStore.js`
- `src/views/dashboards/admin/index.ejs`

Implemented:
- Rich backend detail helpers for bookings, companies, listings, payments, promoters, customers, support, campaigns, refunds, notifications, audit logs, and admin users.
- Super Admin overview is now driven from real store counts/revenue instead of fixed numbers.
- Overview now exposes all requested metric groups including users, partners, listings, bookings, revenue, commissions, settlements, withdrawals, support cases, and recent activity.
- Super Admin tables now receive richer row metadata and grouped full-record details.
- View buttons now open a modal inside the same dashboard design with full grouped backend details instead of opening another page.
- Row actions now include copy/export JSON where safe.
- Unsafe write actions are disabled/locked when no safe backend endpoint exists.
- Partner actions still use real existing approve/reject/suspend endpoints.
- Added per-table search, status filter, date filter, and CSV export without replacing the design.
- Added richer system health and platform settings data to the backend dashboard payload.

### B. Company Admin Dashboard — implemented in this pass
Files changed:
- `src/services/data/demoStore.js`
- `src/views/dashboards/company/index.ejs`

Implemented:
- Added company dashboard enrichment layer that attaches full details to company listings, routes, vehicles, schedules, bookings, check-ins, inventory, staff, payouts, promotions, reviews, and support rows.
- View buttons now open full grouped details in the existing modal, in the existing dashboard design.
- Added per-row JSON export.
- Preserved existing real action forms for listings/routes/vehicles/schedules/rooms/check-in/support/review/payouts.
- Added no-show action where check-in rows support it.
- Disabled unsafe generic row actions instead of leaving fake buttons.
- Added per-table search, status filter, date filter, and CSV export without changing the visual design.

### Existing corrected scanner retained
- The Employee dashboard still includes the in-tab `html5-qrcode` QR scanner added in the corrected pass.
- It keeps lookup-before-check-in and full booking card behavior.

## Checks run
- `npm run check` passed.
- Render check for `dashboards/admin/index.ejs` passed.
- Render check for `dashboards/company/index.ejs` passed.
- `npm test -- --runInBand` passed: 4 suites, 28 tests.

Note: the test suite intentionally logs a webhook signature error in the negative webhook test, but the test passes.

## Next line in the uploaded prompt
Next section to implement is:

### C. Company Employee Dashboard
Continue top-to-bottom with:
1. Full operational check-in tools audit against the prompt.
2. Make sure the QR scanner is stable and does not create separate pages.
3. Enrich Bookings Desk, Schedules, Seats/Rooms, Customers, Payments, Refund Requests, Support Tasks, Shift Handover, My Reports, and My Profile with full details and real actions.
4. Keep the existing employee dashboard design.

## Pass 2 - Company Employee Dashboard (section C)

Implemented the next top-to-bottom prompt section after Company Admin: Company Employee Dashboard.

Files changed:
- `src/services/data/demoStore.js`
- `src/views/dashboards/employee/index.ejs`
- `package-lock.json` (refreshed by npm install so tests could run in this workspace)

Completed against section C:
- Preserved the existing employee dashboard layout/design.
- Kept the QR scanner inside the existing Ticket Check-in tab; no separate view page was introduced.
- Enriched Ticket Check-in rows with full booking/customer/company/service/payment/split/check-in metadata.
- Enriched Bookings Desk rows with full modal details and real check-in/no-show/payment/refund/customer-note actions.
- Enriched Schedules rows with schedule, route, vehicle, service, manifest, occupancy, and operations metadata.
- Enriched Seats / Rooms rows with schedule-linked seat/room status, current booking, hold information, and service details.
- Enriched Customers rows with booking count, spend, latest booking, and note/support metrics.
- Enriched Payments rows with booking/payment/provider/reference/status metadata.
- Enriched Refund Requests rows with refund, booking, review, and timestamp metadata.
- Enriched Support Tasks rows with case/customer/booking/company/resolution metadata and real resolve action.
- Enriched Shift Handover rows with employee/company/shift metadata.
- Added employee activity metrics for check-ins, payments recorded, notes added, manual bookings, and refunds handled.
- Updated row actions to avoid fake/dead edit buttons; each row now shows real actions or a disabled lock with a reason.
- Added per-row JSON export.
- Added search, status filter, date filter, and CSV export to employee dashboard tables without replacing the design.
- Updated full-detail modal rendering so it works for all employee row types, not only bookings.

Verification:
- `npm install` completed.
- `npm run check` passed.
- Employee EJS render check passed.
- `npm test -- --runInBand` passed: 4 suites, 28 tests.

Next in the prompt:
- D. Customer Dashboard: Overview, My Bookings, Current Ticket, Saved Trips, Receipts, Refunds, Support, Reviews, Wallet, Notifications, Profile, and Security.

## Pass 3 - Customer Dashboard (section D)

Implemented the next top-to-bottom prompt section after Company Employee: Customer Dashboard.

Files changed:
- `src/services/data/demoStore.js`
- `src/views/dashboards/customer/index.ejs`
- `IMPLEMENTATION_LINE_BY_LINE.md`
- `package-lock.json` (refreshed by npm install in this workspace)

Completed against section D:
- Preserved the existing Customer Dashboard layout/design; no separate details page or replacement dashboard was introduced.
- Customer Overview now receives backend-driven metrics for active booking, upcoming trips, past bookings, wallet balance, refunds, support cases, reviews, and total spend.
- Overview next-trip panel is populated from the active booking instead of fixed text.
- My Bookings rows now include full booking/customer/company/service/payment/split/check-in/timestamp metadata behind the same-page View modal.
- Current Ticket now renders from the active booking and shows booking code, passenger, payment reference, check-in status, lookup code, company contact, and seat/room data inside the existing ticket card.
- Saved Trips rows now carry listing/company/inventory/service details and expose safe row actions.
- Receipts rows now carry payment/booking/customer/company/split metadata and support CSV/JSON export.
- Refunds rows now carry refund, booking, customer, company, and payment metadata.
- Support rows now carry case/requester/related booking/timestamp metadata.
- Reviews rows now distinguish submitted, pending, and not-eligible records with booking/review metadata.
- Wallet rows now show wallet transactions or balance fallback with transaction/wallet metadata.
- Notifications rows now use real notification records when available, or booking-derived notifications with detail metadata.
- Profile form is populated from the customer/user/booking data instead of hard-coded customer text.
- Security table now exposes customer-scoped session, password, and email verification detail rows.
- Added grouped full-record modal rendering for all customer rows.
- Added copy-reference and per-row JSON export actions.
- Added table-level search, status filter, date filter, and CSV export across customer tables.
- Replaced fake delete/edit row buttons with safe view/copy/export actions plus disabled locks where no safe endpoint exists.
- Export buttons now generate actual CSV files for bookings and receipts from currently loaded dashboard data.

Verification:
- `npm install` completed.
- `npm run check` passed.
- Customer EJS render check passed.
- `npm test -- --runInBand` passed: 4 suites, 28 tests.

Next in the prompt:
- E. Promoter Dashboard: Overview, Referral Links, Share Listings, Commissions, Withdrawals, Performance, Campaigns, Referral Bookings, Payout History, Traffic Review, Support, and Profile.

## Pass 4 - Promoter Dashboard (section E)

Implemented the next top-to-bottom prompt section after Customer: Promoter Dashboard.

Files changed:
- `src/services/data/demoStore.js`
- `src/views/dashboards/promoter/index.ejs`
- `IMPLEMENTATION_LINE_BY_LINE.md`
- `package-lock.json` (refreshed by npm install in this workspace)

Completed against section E:
- Preserved the existing Promoter Dashboard layout/design; no separate details page or replacement dashboard was introduced.
- Promoter Overview now receives backend-driven metrics for referral code, total bookings, confirmed/paid bookings, cancelled/refunded bookings, gross referred revenue, commission earned, withdrawable balance, paid withdrawals, pending withdrawals, active links, and conversion rate.
- Referral Links rows now expose full link/listing/company/referral/finance/promoter/timestamp metadata behind same-page View modals.
- Referral Links include real copy/share metadata such as marketplace URL, listing URL, WhatsApp share URL, email share URL, and QR payload.
- Share Listings rows now expose listing/company/service/inventory/referral metadata and safe copy/share/export actions.
- Commissions rows now expose booking/customer/company/service/payment/split/settlement metadata and support full modal inspection.
- Withdrawals rows now expose wallet, payout account, withdrawal transaction, method/account, status, reference, and timestamp metadata.
- Performance data now includes promoter-derived bars, best listings, best companies, and bookings-over-time metadata.
- Campaigns rows now expose campaign/owner/target/timestamp metadata through the same dashboard modal system.
- Referral Bookings rows now expose full booking/customer/company/service/payment/split/check-in detail metadata.
- Payout History rows now expose wallet/current-balance and withdrawal transaction details with CSV export.
- Traffic Review rows now show quality indicators for cancelled referrals, failed payments, duplicate contacts, and cancellation rate with full metadata.
- Support rows now expose promoter-scoped support case/requester/related booking/timestamp metadata.
- Profile and payout forms are now populated from promoter/user/wallet data instead of fixed hard-coded text.
- Added grouped same-page detail modal rendering for all promoter rows.
- Added copy-link/reference and per-row JSON export actions.
- Added WhatsApp share action where a safe share URL exists.
- Added table-level search, status filter, date filter, and CSV export across promoter tables.
- Replaced fake edit/delete row buttons with safe view/copy/share/export actions plus disabled locks where no safe endpoint exists.
- Export buttons now generate real JSON or CSV files from the currently loaded promoter dashboard data.

Verification:
- `npm install` completed.
- `npm run check` passed.
- Promoter EJS render check passed.
- All five dashboard EJS render checks passed: admin, company, employee, customer, promoter.
- `npm test -- --runInBand` passed: 4 suites, 28 tests.

Next in the prompt:
- General implementation requirements: full data mapping consistency, full view modals everywhere, working actions, search/filter/export, QR scanner/check-in verification, validation/permissions, backend consistency, UI consistency, database safety, and audit trail coverage review across all dashboards.

## Pass 5 - General implementation requirements review and hardening

Implemented the next top-to-bottom prompt section after Promoter: General implementation requirements.

Files changed:
- `src/app.js`
- `src/middlewares/apiAuth.js`
- `src/controllers/api/dashboardController.js`
- `src/controllers/api/scannerController.js`
- `src/controllers/employee/scannerController.js`
- `src/routes/api/dashboards.js`
- `src/routes/api/scanner.js`
- `src/services/booking/bookingService.js`
- `src/services/data/demoStore.js`
- `src/models/Booking.js`
- `src/models/Payment.js`
- `src/models/SupportTicket.js`
- `src/models/RefundRequest.js`
- `src/models/AuditLog.js`
- `src/models/Notification.js`
- `src/models/Setting.js`
- `src/models/PlatformSetting.js`
- `src/models/ShiftHandover.js`
- `src/models/SavedListing.js`
- `package-lock.json` (refreshed by npm install in this workspace)

Completed against General implementation requirements:
- Added protected dashboard data APIs while keeping the existing EJS dashboards as the primary UI:
  - `GET /api/dashboards/data`
  - `GET /api/dashboards/:role/data`
  - `POST /api/dashboards/actions/:action`
- Added JSON API auth/role middleware for protected API routes, with role checks for customer, promoter, company employee, company admin/partner, admin, and super admin.
- Hardened scanner APIs so lookup/check-in/no-show endpoints require authenticated allowed roles outside test mode.
- Tightened scanner company scoping: normal company users and employees use their session company ID; admin/super admin may pass company ID for platform support.
- Added input validation for scanner lookup/check-in/no-show so empty requests return a 422 JSON error with a clear message.
- Preserved the existing same-page employee QR scanner design and kept `/employee/scanner/*` protected by the employee web route guard.
- Extended scanner audit metadata for check-in and no-show actions with actor role, entity type/id, before/after summaries, IP, user agent, and success status.
- Extended booking persistence so check-in/no-show fields are saved when MongoDB is connected:
  - `checkInStatus`
  - `checkInNote`
  - `checkedInByUserId`
  - `noShowAt`
  - `noShowBy`
  - `noShowByUserId`
  - cancellation/completion/settlement fields
- Expanded production-safe Mongoose schemas for richer dashboard data:
  - Booking now includes lookup, payment, settlement, wallet, check-in, no-show, note, and audit fields with useful indexes.
  - Payment now includes company/customer references, checkout URL, failure reason, method note, split amounts, settlement status, and metadata.
  - SupportTicket now includes company/booking/payment links, category, assignment, resolution, reopen, replies, and metadata.
  - RefundRequest now includes company/payment/customer links, requested/reviewed/rejected metadata, and notes.
  - AuditLog now supports actor identity, entity type/id, before/after summaries, IP, user agent, and status.
  - Notification now supports audience targeting, channels, createdBy, delivery counters, and delivery status.
  - Setting now supports labels, groups, editable flag, and updatedBy.
- Added missing safe models required by the prompt:
  - `PlatformSetting`
  - `ShiftHandover`
  - `SavedListing`
- Kept all dashboard rich-data changes inside the existing dashboard architecture instead of creating another design.
- Reconfirmed same-page modal rendering across all five dashboard views with the dashboardData payloads.
- Reconfirmed tests after the API hardening and schema expansion.

Verification:
- `npm install` completed.
- `npm run check` passed.
- All five dashboard EJS render checks passed: admin, company, employee, customer, promoter.
- `npm test -- --runInBand` passed: 4 suites, 28 tests.
- The test suite intentionally logs the expected missing webhook signature error while testing payment webhook protection; the test still passes.

Next in the prompt:
- Expected Codex workflow Step 4/Step 5 finalization: run/start verification where possible, package the final full line-by-line build, and provide a final summary of files changed, features completed, new endpoints/models/fields, testing instructions for each dashboard, and remaining limitations.

## Pass 6 - Expected workflow Step 4 / Step 5 final verification and packaging

Implemented the final top-to-bottom workflow section after General implementation requirements.

Files changed in this final pass:
- `src/config/session.js`
- `IMPLEMENTATION_LINE_BY_LINE.md`
- `FINAL_COMPLETION_REPORT.md`

Final correction made:
- Fixed development startup when MongoDB is not running. The app already falls back to the in-memory demo store when MongoDB is unavailable, but `connect-mongo` could still open its own session-store connection and crash later in development. Session storage now uses Connect-Mongo only in production, where `MONGO_URI` is required, and uses the standard in-memory Express session store in development/test mode.

Final verification performed:
- `npm install` completed.
- `npm run check` passed.
- `npm test -- --runInBand` passed: 4 test suites, 28 tests.
- HTTP smoke checks passed after login for all five dashboards:
  - `/admin`
  - `/company/dashboard`
  - `/employee/dashboard`
  - `/account`
  - `/promoter/dashboard`
- `npm start` launched successfully in development with MongoDB unavailable; the app logged the expected warning and continued with the in-memory demo store.

Final package produced:
- `classic-trip-dashboard-line-by-line-final.zip`

Next in the line:
- The uploaded prompt has now been processed through the final workflow section. The remaining work is not another prompt section; it is production deployment work: connect real MongoDB, seed/verify production data, add browser/E2E tests around QR camera permissions, and perform user acceptance testing with real company/customer/promoter accounts.
