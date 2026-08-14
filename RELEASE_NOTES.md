# Classic Trip v1.6.81

## Bus checkout + Pesapal handoff fix
v1.6.81 targets the exact production timings reported on Render:
- `/book/bus/:slug/prepare` spent almost all of its time creating the secure seat hold.
- `/book/bus/:slug` re-read authoritative availability again just to render the passenger/payment form.
- `/bookings/guest` returned at roughly the old 6-second Pesapal request timeout and could preserve a pending booking without ever receiving a Pesapal `redirect_url`.

Changes:
- Bus hold transactions now keep only the two durability-critical writes on the synchronous path: seat-segment claim + authoritative hold row. Reconstructible hold-item/outbox/audit projections are persisted immediately after commit without blocking the traveler.
- New server-side booking drafts store a trusted checkout snapshot. The booking form reuses it instead of reading bus availability from Atlas again.
- The Pay click reuses the same trusted draft snapshot; the final hold attachment still revalidates the hold atomically in MongoDB.
- Canonical booking persistence and Pesapal SubmitOrderRequest now run concurrently, so latency is the slower operation instead of their sum.
- Pending provider intent/payment projections are retry-safe and finish after the booking itself has been durably bound to the Pesapal tracking reference.
- Pesapal SubmitOrderRequest timeout is now configurable with `PESAPAL_REQUEST_TIMEOUT_MS` and defaults to 12 seconds instead of the previous 6-second cutoff.
- Pesapal requests explicitly use `TOP_WINDOW` and provide a cancellation URL.
- If Pesapal does not return a checkout URL, Classic Trip no longer acts like payment started; the traveler is sent to a retry-safe pending-payment page with Continue payment.
- New timing logs expose seat-hold availability/transaction stages and Pesapal SubmitOrderRequest timing.

No dependency versions changed from v1.6.80.
