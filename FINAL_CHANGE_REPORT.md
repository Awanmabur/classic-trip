# Classic Trip Final Change Report

## Status

The audited partial and missing blueprint items have been completed end-to-end across backend routes/services/models and the EJS dashboard/public UI. The project now passes syntax validation and the full Jest suite.

## Implemented

- Missing items found in this continuation:
  - No plan catalog or public pricing page existed.
  - Partner onboarding stopped at a pending request and did not continue into checkout.
  - Existing companies had no upgrade path from dashboard to payment.
  - Payment webhooks only settled bookings, not plan/subscription orders.
  - Company billing state was not visible in dashboard or health/status output.

- Security and validation:
  - Real session-backed CSRF middleware with form/fetch injection.
  - Form/API validation wired for auth, booking, payments, company onboarding, support, and withdrawals.
  - Browser-friendly validation errors plus JSON errors for API requests.

- Auth and account recovery:
  - Login/register validation.
  - Forgot-password and reset-password routes, controller, service token flow, and reset page.
  - Google OAuth now blocks suspended/blocked users.

- Public flows:
  - Guest support form persists support tickets.
  - Partner request form creates pending company onboarding records and an onboarding support ticket.
  - Public marketplace CTAs now point to real dashboard routes instead of placeholder toasts.
  - Remaining public booking, saved-item, sharing, receipt, and availability messages use concrete platform copy instead of prototype wording.
  - Added `/pricing`, `/partner/onboarding`, `/billing/checkout/:orderRef`, and `/billing/success/:orderRef`.
  - New partner onboarding now selects a plan, creates a company/admin owner, creates a subscription order, collects payment, and activates the plan on successful payment.

- Customer and promoter dashboards:
  - Customer profile and support forms post to real backend handlers.
  - Customer saved-trip, wallet top-up, security settings, refund, review, support, and become-promoter flows now submit to real backend routes and persist to dashboard data.
  - Promoter profile, payout account, support, and withdrawal forms post to real backend handlers.
  - Promoter campaign creation and verification updates now submit to backend handlers and persist to campaign/user records.
  - Promoter referral links can be archived from the dashboard through `POST /promoter/links/:id/archive`.
  - Archived promoter links are hidden from promoter link lists and no longer receive click or booking attribution.
  - Stale locked/missing-action dashboard buttons were replaced with real safe actions such as view/export/copy/archive.

- Refunds, disputes, and ledger reversals:
  - Refund approval now credits the customer wallet and reverses company/promoter/platform earnings proportionally.
  - Commission status is updated for full and partial refunds.
  - Admin refund rejection is wired.
  - Fraud scoring now records reasons and creates manual review support tickets for high-risk bookings.

- Payments and ticketing:
  - Payment provider registry supports mock, MTN MoMo, Airtel Money, Flutterwave, Paystack, and DPO adapters.
  - External providers use pending booking settlement until webhook confirmation.
  - Webhooks settle successful bookings once and are idempotent.
  - Plan checkout reuses the same provider registry: mock confirms immediately, external providers stay pending until signed webhook confirmation.
  - Signed payment webhooks now settle both booking payments and subscription-order payments.
  - Ticket PDFs are generated with PDFKit and upload to Cloudinary when real Cloudinary credentials are configured.
  - Placeholder Cloudinary values are treated as unconfigured, preventing accidental failed uploads in development.

- Marketplace search:
  - Added filters for rating, instant confirmation, refundable listings, availability, and best-value sorting.
  - Frontend search controls and marketplace aside links expose the new filters.

- Jobs and notifications:
  - Booking reminders, promotion expiry, payout reports, expired-lock cleanup, and commission release are registered with the scheduler.
  - Email, SMS, and WhatsApp adapters queue safely when provider credentials are absent.

- Dashboard workflows:
  - Admin modal-created actions now post to real routes for booking creation, listing creation, payout run/freeze, finance rules, price rules, promotions/ads, customer notes, platform notices, notifications, admin invites, verification tasks, refunds, custom reports, and notification templates.
  - Admin support/settings panel forms and report cards now submit/download through backend routes instead of toast-only UI.
  - The dashboard enhancer no longer disables wired edit/delete/create actions or blocks backend-enabled forms.
  - Company and employee booking, inventory, delay notice, payment record, refund request, support notice, handover, profile, payout, review reply, and report flows persist through backend services.
  - Admin company approval/rejection/suspension and refund approval/rejection flows are wired.
  - Destructive-action confirmation copy now describes permission, privacy, and audit behavior without future-system placeholders.
  - Company dashboard now includes Plans & Billing, current subscription status, pending order continuation, and upgrade forms that route to checkout.

- UI polish:
  - Ticket QR validation now uses a CSRF-protected fetch handler with loading state and toast feedback.
  - Listing detail hold and checkout validation now uses the existing toast surface instead of blocking browser alerts.

## Verification

```bash
npm.cmd run check
npm.cmd test -- --runInBand
```

Result:

- Syntax check passed.
- Jest passed: 4 test suites, 38 tests.

## Production Notes

- Real external provider behavior requires real environment values in `.env`.
- `PAYMENT_PROVIDER=mock` remains the safe development default.
- Partner plan checkout is production-wired through the payment provider registry and signed webhook settlement.
- Cloudinary upload is active only when real `CLOUDINARY_*` values are set.
- Jobs run automatically in production or when `ENABLE_JOBS=true`.
- Still intentionally external: real card/mobile-money/bank settlement depends on live provider credentials and signed provider webhooks; provider integrations are configured but not live without those values.
