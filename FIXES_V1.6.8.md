# Classic Trip v1.6.8 fixes

- Fixed the rolling worker `undefined.findOne` crash by completing the company repository contract for `routes` and `routeStops`.
- Added route selection opposite Standard/VIP ticket date and time; boarding and drop-off remain together below.
- Bus cards and bar views now expose every active route attached to the listing.
- Fixed company dashboard listing column alignment and derives **Price from** from active segment fares when the listing base price is empty.
- Return departures must start strictly after the outbound arrival/departure time, enforced in search, booking-draft, final-booking, and browser validation.
- Removed global marketing reads of up to 50,000 seat records and 50,000 room-night records; detailed inventory remains listing/checkout scoped.
- Memoized the already-cached home bootstrap projection to avoid rebuilding all public card data on every request.
- Enlarged the public top navigation and rebuilt the phone bottom navigation into a stable five-column safe-area layout.
