# Classic Trip v1.6.83

## Payment enum correction + amenity layering
v1.6.83 is a narrow follow-up to the Pesapal handoff release. It corrects the bus checkout state written before the first booking persistence and removes the extra amenity spacing introduced in v1.6.82.

Changes:
- Successful Pesapal initiation now stages the verified provider URL server-side and redirects to a same-origin Classic Trip handoff page.
- The handoff page loads the exact verified Pesapal `redirect_url` in a secure iframe and provides an explicit **Open Pesapal payment** top-window fallback.
- Only HTTPS `pesapal.com` / `*.pesapal.com` checkout URLs are accepted by the handoff controller.
- CSP `frame-src` and Permissions Policy explicitly allow only Pesapal payment origins required by the checkout page.
- The handoff is private/no-store and retains the retry-safe booking flow if the checkout URL is missing or expires.
- Existing v1.6.81 performance work remains: trusted draft checkout snapshot, reduced seat-hold transaction, parallel Mongo/Pesapal initiation, 12-second configurable provider timeout and provider-stage timing.
- Bus checkout now writes `paymentInitiationStatus: pending`, which is a valid Booking enum value, instead of the invalid `initiating` state.
- Bus amenity lanes keep their original compact dimensions (54px Cards / 52px Bars); no extra bottom margin or card/bar height is added.
- Amenities use a higher stacking layer than the bus price/actions footer in both Cards and Bars, while the footer background stays transparent, so the bottom amenities remain visible in front.
- No dependency versions changed from v1.6.81/v1.6.80.
