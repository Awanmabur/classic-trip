# Classic Trip v1.6.85 — Exact Amenity Fit + Light Notification Contrast Final Audit

## Production incidents addressed

The August 15 Render trace proves the earlier secure-hold correction is working: bus checkout preparation fell from about **5.44 seconds** before deployment to about **1.40–1.45 seconds** afterward. Pesapal handoff is also opening successfully. The remaining checkout warning is now dominated by MongoDB canonical booking persistence (~2.83 seconds in the newest sample), while Pesapal SubmitOrderRequest improved to ~1.16 seconds and runs concurrently with that persistence.

This release does not weaken live seat authority, the booking transaction, idempotency, or payment verification to chase latency.

## v1.6.85 corrections

### Amenities — actual clipping root cause fixed

- The remaining amenity problem was not stacking order. The amenity scroller itself was too small for its children once vertical padding was included.
- Card geometry was **25px + 4px gap + 25px + 4px vertical padding = 58px inside a 54px box**.
- Bar geometry was **24px + 4px gap + 24px + 4px vertical padding = 56px inside a 52px box**.
- Because the amenity scroller intentionally uses `overflow-y:hidden`, the bottom of lane two was physically clipped.
- v1.6.85 removes only the amenity scroller's vertical padding. Card lanes now fit exactly **25 + 4 + 25 = 54px** and Bar lanes fit exactly **24 + 4 + 24 = 52px**.
- No extra gap, margin, footer spacer, card height, or bar height is added.
- The existing front-layer stacking remains: amenity list/track/lane/chips paint above the price/actions layer and the bus footer remains transparent.

### Notification cards — light-mode contrast fixed

- Public pages define `--card` and `--text`, but not `--panel`.
- The notification popup previously fell back to a hard-coded dark panel while light mode supplied black `--text`, producing black text on a dark card.
- The popup now falls back through `--panel` → `--card` → dark default, so public light mode uses the white page card.
- Explicit light-theme guards force readable foreground/background colors for the floating notification panel, notification items, status copy, and dashboard notification-page cards.

### Pesapal keep-warm logging

- Pesapal remains refreshed every four minutes so the normal checkout path can reuse a warm control plane.
- The first successful warm remains an `info` message.
- Routine successful refreshes are now `debug` only, removing repetitive production log noise without changing payment behavior.

### Runtime/performance protections retained from v1.6.84

- Bus listing preview primes mutable schedule state plus immutable route/seat/fare publication snapshots from already-warm discovery data.
- Secure checkout preparation primes the same context before the hold transaction, while live segment inventory remains authoritative.
- Ticket lookup prefers the Redis/memory public discovery snapshot before scoped/full operational catalog fallbacks.
- Payment initiation uses the valid Booking enum state `pending`, never `initiating`.
- Mongo pending-booking persistence and Pesapal SubmitOrderRequest run concurrently.
- Pesapal handoff remains same-origin with verified checkout URL handling and direct top-window fallback.
- Final payment status and amount/currency are verified before ticket issuance.

## Validation completed in the artifact workspace

- Public layout/content: **22/22**
- Checkout-speed gate: **28/28**
- Unit regression fixes: **9/9**
- Commercial agreements: **21/21**
- Backend end-to-end: **20/20**
- Public performance: **20/20**
- Cold Home warmup: **9/9**
- Runtime/network: **15/15**
- Fast runtime/UI: **10/10**
- Launch security controls: **20/20**
- Log redaction: **8/8**
- Pesapal provider security: **16/16**
- Pesapal go-live: **9/9**
- Release consistency: **11/11**
- Production cleanup: **17/17**
- Lockfile integrity: **17/17**
- Clean-package secret hygiene: **5/5**

## Dependency-backed validation note

No dependency versions changed. Run `npm ci`, `npm test`, and `npm audit --omit=dev --audit-level=moderate` on the extracted release as the final dependency-backed check. The expected unit target remains **115/115 or higher with 0 failures**.

## Existing repository security action

The production package contains no `.git` history or local `.env`. The previously detected credential-bearing MongoDB URI in repository history remains a separate launch action: rotate that database password and purge the old URI from Git history rather than suppressing the secret-hygiene gate.
