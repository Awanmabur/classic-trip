# Classic Trip Platform

This is a Node.js + Express + MongoDB + Mongoose + EJS monolith scaffold built from the uploaded Classic Trip blueprint and the provided HTML designs. The marketplace design is preserved from `classic_trip_multi_tenant_booking_pages_v22(1).html`; the uploaded dashboards are copied into role routes unchanged so the visual direction stays intact.

## What is implemented

- Public marketplace homepage migrated to EJS, with the uploaded design preserved.
- Expanded backend demo data: 30 partner companies, 95 service listings, 30 bus routes, 120 schedules, 120 hotel room records, 10 starter bookings, promoter links, wallets, campaigns, support tickets, refunds and blog posts.
- Public pages:
  - `/` marketplace
  - `/search` backend-filtered listings
  - `/services` all service categories
  - `/routes` route directory
  - `/companies` partner directory
  - `/companies/:slug` partner profile
  - `/promoters` promoter program, links and marketing assets
  - `/listings/:serviceType/:slug` listing detail
  - `/book/:serviceType/:slug` guest checkout
  - `/booking/success/:bookingRef`
  - `/tickets` guest ticket lookup
  - `/tickets/:bookingRef`
  - `/tickets/:bookingRef.pdf`
  - `/blogs`
  - `/health`
- Role dashboard routes using the uploaded visual prototypes:
  - `/admin`
  - `/company/dashboard`
  - `/employee/dashboard`
  - `/account`
  - `/promoter/dashboard`
- Clean route file names: `public.js`, `auth.js`, `customer.js`, `company.js`, `employee.js`, `promoter.js`, `admin.js`.
- API routes for search, listings, bookings, payments, scanner validation, webhooks and uploads.
- Mongoose model files for all major blueprint entities.
- Cloudinary upload service with production folder targets for company logos, covers, documents, listing images, blogs and tickets.
- Google OAuth wiring with Passport Google OAuth 2.0. It is disabled until Google environment variables are set.
- Guest checkout with mock payment, booking reference, QR ticket value, downloadable PDF ticket and one-time scanner validation.
- Notification adapters for SMTP email plus HTTP SMS/WhatsApp providers, with safe queued fallback when provider credentials are not configured.
- Wallet, ledger and commission split logic:
  - With valid promoter referral: promoter 3%, platform 7%, company 90%.
  - Without referral: platform 10%, company 90%.
- Seat lock and room reservation services for temporary holds.
- Promotion/sponsored listing logic where sponsored listings remain visibly labeled.
- Scheduled jobs for commission release, promotion expiry, booking reminders, expired locks and payout reports. They run in production or when `ENABLE_JOBS=true`.
- Release roadmap API for v1, teaser, architecture-ready, and future platform features.
- Integration and unit coverage for booking flow, commission splits, company management, platform hardening, scheduled jobs, ticket PDFs, webhooks and promoter link archive behavior.

## First run

```bash
cd classic-trip-platform
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:5000
```

## Demo login accounts

Use the password below for every demo account:

```text
Password123
```

Accounts:

```text
admin@classictrip.test       -> /admin
company@classictrip.test     -> /company/dashboard
employee@classictrip.test    -> /employee/dashboard
customer@classictrip.test    -> /account
promoter@classictrip.test    -> /promoter/dashboard
```

## MongoDB and demo store

The app can boot with the in-memory demo store during development. When `MONGO_URI` is reachable, `npm run seed` inserts the demo records into MongoDB.

```bash
npm run seed
```

## Environment notes

Real production values are required for:

- `MONGO_URI`
- `SESSION_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `SMS_API_URL`
- `SMS_API_TOKEN`
- `WHATSAPP_API_URL`
- `WHATSAPP_API_TOKEN`
- `ENABLE_JOBS`
- Real payment provider keys when replacing the mock provider.

Production ticket PDFs are generated with PDFKit at `/tickets/:bookingRef.pdf`. Cloudinary upload support is available in the PDF service once Cloudinary credentials are configured.

## Current implementation status

The audited blueprint gaps have been completed through the current Express/EJS architecture. Dashboard forms now persist through backend services, support and partner onboarding are wired, refunds reverse ledger entries, scheduled jobs do real work, payment adapters are configurable, and ticket PDFs are generated locally with Cloudinary upload support when production credentials are present.

See `FINAL_CHANGE_REPORT.md` for the full implementation summary and verification results.
