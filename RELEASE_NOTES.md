# Classic Trip v1.6.84

## Amenity layering + warm booking reads

This is a targeted follow-up to v1.6.83 based on the August 15 production trace.

Changes:
- Bus amenities in both **Cards** and **Bars** now paint above the lower price/actions layer instead of creating extra vertical space to avoid it.
- The old extra card clipping-repair bottom padding is removed for bus cards; normal card spacing is restored.
- Amenity dimensions stay compact at 54px on Cards and 52px on Bars; no new bottom margin or artificial card/bar height is introduced.
- Bus listing preview primes schedule/publication context from the already-warm discovery snapshot before the browser's first availability request.
- Secure checkout preparation primes the same context before creating the hold, while live segment inventory remains authoritative.
- Ticket lookup now prefers the Redis/memory public discovery snapshot before operational catalog fallbacks, addressing the slow `/tickets` path in the production trace.
- The v1.6.83 `paymentInitiationStatus: pending` correction remains in place.
- Existing Pesapal handoff, payment verification, secure holds, commercial agreements and security controls are unchanged.
- No dependency versions changed.
