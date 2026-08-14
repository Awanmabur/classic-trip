# Classic Trip v1.6.81 — Checkout / Pesapal Handoff Final Audit

## Incident addressed
Render logs showed a bus checkout prepare request around 5.9 seconds, the booking page around 4.2 seconds, and the guest booking POST around 6.2 seconds. The guest booking duration aligned with the previous 6-second Pesapal request timeout and the customer never received a Pesapal payment prompt.

Pesapal API 3.0 requires SubmitOrderRequest to return a `redirect_url`; the merchant must redirect the customer to that URL or load it in an iframe. v1.6.81 makes that handoff explicit and retry-safe.

## Runtime corrections
- Secure seat-hold transaction reduced to inventory claim + authoritative hold only.
- Booking draft now freezes a server-side checkout snapshot for the active hold.
- Bus booking page uses Redis/session-backed discovery + draft snapshot instead of another Atlas availability read.
- Pay POST reuses the trusted checkout snapshot while the final Mongo hold attachment remains atomic and authoritative.
- Mongo booking persistence and Pesapal SubmitOrderRequest run concurrently.
- Pending provider projections are deferred after the booking/provider binding is durable.
- Pesapal request timeout defaults to 12,000ms and is configurable via `PESAPAL_REQUEST_TIMEOUT_MS`.
- Pesapal SubmitOrderRequest logs provider timing without credentials.
- Missing provider checkout URL routes to a retry-safe payment state rather than booking-success behavior.
- `redirect_mode=TOP_WINDOW` and a cancellation URL are sent to Pesapal.

## Validation completed in the artifact workspace
- Checkout-speed gate: 19/19
- Commercial agreements: 21/21
- Backend end-to-end: 20/20
- Launch security controls: 20/20
- Log redaction: 8/8
- Pesapal provider security: 16/16
- Pesapal go-live: 9/9
- Public performance: 20/20
- Public layout/content: 20/20
- Runtime/network: 15/15
- Cold Home warmup: 9/9
- Fast runtime/UI: 10/10
- Production cleanup: 17/17
- Release consistency: 11/11
- Lockfile integrity: 17/17
- Production architecture: 7,142/7,142
- JavaScript syntax: 640/640

The dependency graph is unchanged from v1.6.80. The user's immediately preceding local v1.6.80 run passed 115/115 tests and reported 0 vulnerabilities. Run `npm ci`, `npm test`, and `npm audit --omit=dev --audit-level=moderate` on the extracted v1.6.81 tree as the final dependency-backed check.

## Existing repository security action
The application package remains clean, but the user's Git history previously contained a credential-bearing MongoDB URI. Rotate that database password and purge the old URI from Git history rather than suppressing `check:secret-hygiene`.
