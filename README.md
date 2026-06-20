# Classic Trip Platform

Classic Trip is a Node.js + Express + MongoDB + Mongoose + EJS monolith for a multi-tenant travel marketplace. Public booking, company operations, employee/driver tools, customer accounts, promoter workflows, and super-admin controls now run through one production dashboard system with role-scoped data and actions.

## What is implemented

- Public marketplace homepage migrated to EJS, with the uploaded design preserved.
- Expanded backend reference seed data: 30 partner companies, 95 service listings, 30 bus routes, 120 schedules, 120 hotel room records, 10 starter bookings, promoter links, wallets, campaigns, support tickets, refunds and blog posts.
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
- Unified role dashboard routes:
  - `/admin`
  - `/company/dashboard`
  - `/employee/dashboard`
  - `/driver/dashboard`
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
- Integration and unit coverage for booking flow, driver manifests, hotel operations, support timelines, commission splits, company management, platform hardening, ticket PDFs, webhooks, promoter/agent workflows, and acceptance criteria.

## First run

```bash
cd classic-trip-platform
cp .env.example .env
npm install
npm run lint
npm test
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

## MongoDB-first data layer

The old in-memory demo store has been removed from runtime. The app expects MongoDB as the system of record when `DEMO_MODE=false`. For local development, start MongoDB, seed the reference data, then run the app:

```bash
npm run seed:local
npm run seed:counts
npm run dev
```

Use `AUTO_SEED_MONGO=true` only for local/dev bootstrapping when the database is empty.

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

The implementation is MongoDB-first with seeded platform records, transaction-style checkout persistence, seat and hotel room-night locking, signed/idempotent webhook processing, scoped dashboard routes, support/partner onboarding, refund and wallet reversal flows, scheduled cleanup jobs, configurable payment providers, and locally generated ticket PDFs with Cloudinary upload support when production credentials are present.

Recommended release checks:

```bash
npm run check
npm run check:dashboards
npm run check:dashboard-smoke-static
npm run acceptance:matrix
npm run test:acceptance
npm test
```

## Production package cleanup

Tests and audit evidence stay in the repository so the platform remains verifiable. They are excluded from production deploy/package payloads through `.slugignore`, `.npmignore`, and `.dockerignore`.

Runtime-required folders are:

- `src/` application code, views, models, routes, services, seeds, jobs, config, and middleware.
- `public/` active CSS/JS assets served by Express.
- `package.json`, `package-lock.json`, `Procfile`, `.env.example`, and runtime config files.
