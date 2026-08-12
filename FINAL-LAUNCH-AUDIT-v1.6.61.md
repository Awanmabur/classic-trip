# Classic Trip v1.6.61 — Clean Bus Booking URL + Badge Tuning

## User-visible fixes

- Bus checkout no longer exposes the internal booking draft UUID in the visible URL.
- New checkout URL format: `/book/bus/<listing-slug>`.
- The active draft ID remains server-side in the authenticated/guest session and is still submitted as a hidden field during final booking creation.
- Legacy `?draft=<uuid>` checkout links remain accepted and immediately redirect to the clean URL after validating the draft.
- Direct clean checkout access with no active draft safely returns the traveler to the listing rather than exposing an error page.
- Completed bookings clear the active draft pointer.
- Marketplace image badges and departure/inventory count badges are increased one small step from v1.6.60 while mobile sizing remains bounded.
- Asset/service-worker version advanced to v1.6.61 to invalidate cached v1.6.60 booking/card assets.

## Security properties retained

- Seat holds remain bound to the same browser session, listing, schedule, stop pair and selected seats.
- Draft access tokens remain encrypted at rest inside the session draft snapshot.
- Removing the query parameter does not make drafts globally addressable; the active pointer is server-session scoped.
- Legacy draft IDs are validated before the clean redirect is issued.

## Validation

- v1.6.61 focused checks: 12/12
- Release consistency: 11/11
- Lockfile integrity: 17/17 (217 package entries)
- Route security audit: passed
- Multipart CSRF: 44/44
- Browser CSRF synchronization: 4/4
- JavaScript syntax scan: passed

No database migration or reseed is required.
