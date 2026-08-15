# Classic Trip v1.6.84 — Amenity Layering + Warm Booking Reads Final Audit

## Production incidents addressed

The August 15 Render trace showed that the v1.6.83 secure-hold correction was working: bus checkout preparation fell from about 5.44 seconds before deploy to about 1.45 seconds after deploy. The remaining warnings were concentrated in the first live departure availability read (~2.55s), booking persistence during Pesapal initiation (~3.42s within a ~3.93s checkout request), and ticket lookup (~4.51s).

This release does not weaken booking authority to chase those timings. MongoDB remains authoritative for seat inventory, hold attachment, booking persistence and payment verification.

## v1.6.84 corrections

- Bus Card and Bar amenities are brought in front of the lower price/actions layer using stacking order only.
- No new spacer or extra amenity reservation is added.
- The old generic card-clipping repair's extra `padding-bottom:12px` is overridden for bus cards back to the normal 10px body padding.
- Card amenities keep their existing 54px two-lane area; Bar amenities keep their existing 52px two-lane area.
- Amenity list/track/lane/chips render at a higher stacking layer than the bus price/actions row; the bus price/actions background remains transparent.
- Bus listing preview primes mutable schedule state plus immutable route/seat/fare publication snapshots from the already-warm public discovery data. This removes redundant company/listing/snapshot reads from the immediate first availability path when the traveler arrives through the normal preview flow; live segment inventory is still queried authoritatively.
- Secure checkout preparation primes the same schedule context again from discovery before the hold transaction, while `holdSeats` still performs the authoritative live segment-inventory read.
- Ticket lookup now tries the Redis/memory-backed public discovery snapshot first, then falls back to the scoped/full operational catalog only when the listing is no longer present publicly. This removes the unnecessary full-catalog cold path seen in `/tickets?bookingRef=...`.
- The v1.6.83 payment-enum fix is retained: bus payment initiation persists the schema-valid `pending` state, never `initiating`.
- Existing secure payment behavior is unchanged: Mongo pending-booking persistence and Pesapal SubmitOrderRequest overlap; Pesapal handoff remains same-origin with a verified Pesapal checkout URL and direct top-window fallback; final payment status is independently verified before ticket issuance.

## Validation completed in the artifact workspace

- Checkout-speed gate: **27/27**
- Public layout/content: **21/21**
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
- Unit regression fixes: **9/9**
- Lockfile integrity: **17/17**
- Go-live hotfix: **6/6**
- Launch Stays: **21/21**
- Architecture/security: passed
- Production architecture: **7,153/7,153**
- JavaScript syntax: **640/640**
- EJS syntax: **133/133**

## Dependency-backed validation note

The release changes no dependency versions. A fresh `npm ci` attempt in this artifact environment failed at the container/client layer before a usable dependency tree was available, so this audit does **not** claim a fresh `npm test` or `npm audit` result for v1.6.84 here. Run the commands in `FINAL_RELEASE_CHECKLIST.md` after extraction; the expected unit target remains **115/115 or higher with 0 failures**.

## Existing repository security action

The production package contains no `.git` history or local `.env`. The previously detected credential-bearing MongoDB URI in the user's Git history remains a repository-level launch action: rotate that database password and purge the old URI from Git history rather than suppressing the secret-hygiene gate.
