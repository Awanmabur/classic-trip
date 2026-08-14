# Classic Trip v1.6.82

## Pesapal payment handoff + bus card amenities
v1.6.82 addresses the production case where Pesapal `SubmitOrderRequest` returned a valid `redirect_url`, but the traveler still did not see the Pesapal payment methods page after the cross-origin 303 response.

Changes:
- Successful Pesapal initiation now stages the verified provider URL server-side and redirects to a same-origin Classic Trip handoff page.
- The handoff page loads the exact verified Pesapal `redirect_url` in a secure iframe and provides an explicit **Open Pesapal payment** top-window fallback.
- Only HTTPS `pesapal.com` / `*.pesapal.com` checkout URLs are accepted by the handoff controller.
- CSP `frame-src` and Permissions Policy explicitly allow only Pesapal payment origins required by the checkout page.
- The handoff is private/no-store and retains the retry-safe booking flow if the checkout URL is missing or expires.
- Existing v1.6.81 performance work remains: trusted draft checkout snapshot, reduced seat-hold transaction, parallel Mongo/Pesapal initiation, 12-second configurable provider timeout and provider-stage timing.
- Bus listing cards reserve additional vertical space for the two amenity lanes and place those lanes above the price/actions footer so the bottom amenity row remains visible.
- No dependency versions changed from v1.6.81/v1.6.80.
