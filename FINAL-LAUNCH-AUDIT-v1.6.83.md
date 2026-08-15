# Classic Trip v1.6.83 — Payment Enum + Amenity Layering Final Audit

## Incidents addressed
1. Bus checkout attempted to persist `paymentInitiationStatus = "initiating"`, but the Booking schema enum accepts only `not_started`, `pending`, `ready`, `retry_required`, and `failed`. v1.6.83 uses the existing valid `pending` state during provider initiation.
2. The v1.6.82 amenity visibility fix added extra vertical reservation below bus amenities. v1.6.83 removes that added spacing and fixes visibility using stacking order only for both Cards and Bars.

## Runtime corrections
- Secure seat-hold transaction reduced to inventory claim + authoritative hold only.
- Booking draft now freezes a server-side checkout snapshot for the active hold.
- Bus booking page uses Redis/session-backed discovery + draft snapshot instead of another Atlas availability read.
- Pay POST reuses the trusted checkout snapshot while the final Mongo hold attachment remains atomic and authoritative.
- Mongo booking persistence and Pesapal SubmitOrderRequest run concurrently.
- Pending provider binding uses parallel direct booking + payment-intent updates; only the noncritical payment projection is deferred.
- Pesapal order-creation `status: "200"` is normalized to pending until GetTransactionStatus verifies payment.
- Cross-origin 303 handoff is replaced with an internal Classic Trip payment handoff page that embeds the verified Pesapal checkout URL and includes a direct top-window fallback button.
- CSP and Permissions Policy permit payment framing only for Pesapal origins.
- Bus listing amenities retain the original 54px Card / 52px Bar height with no added bottom gap.
- Amenity list/lanes/chips stack above the price/actions footer on both Cards and Bars; the bus footer background remains transparent.
- Bus payment initiation uses the valid Booking enum state `pending` instead of `initiating`.
- Pesapal request timeout defaults to 12,000ms and is configurable via `PESAPAL_REQUEST_TIMEOUT_MS`.
- Pesapal SubmitOrderRequest logs provider timing without credentials.
- Missing provider checkout URL routes to a retry-safe payment state rather than booking-success behavior.
- `redirect_mode=TOP_WINDOW` and a cancellation URL are sent to Pesapal.

## Validation completed in the artifact workspace
- Checkout-speed gate: 25/25
- Commercial agreements: 21/21
- Backend end-to-end: 20/20
- Launch security controls: 20/20
- Log redaction: 8/8
- Pesapal provider security: 16/16
- Pesapal go-live: 9/9
- Public performance: 20/20
- Public layout/content: 21/21
- Runtime/network: 15/15
- Cold Home warmup: 9/9
- Fast runtime/UI: 10/10
- Production cleanup: 17/17
- Release consistency: 11/11
- Lockfile integrity: 17/17
- Production architecture: 7,153/7,153
- JavaScript syntax: 640/640

The dependency graph is unchanged from v1.6.80. The user's immediately preceding local v1.6.80 run passed 115/115 tests and reported 0 vulnerabilities. This artifact container's `npm ci` produced incomplete package stubs and `npm test` could not load `mongoose`, so the dependency-backed suite is not claimed for v1.6.83 here. Run `npm ci`, `npm test`, and `npm audit --omit=dev --audit-level=moderate` on the extracted v1.6.83 tree as the final dependency-backed check.

## Existing repository security action
The application package remains clean, but the user's Git history previously contained a credential-bearing MongoDB URI. Rotate that database password and purge the old URI from Git history rather than suppressing `check:secret-hygiene`.
