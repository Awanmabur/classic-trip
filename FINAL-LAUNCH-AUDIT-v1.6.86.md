# Classic Trip v1.6.86 — Company Dashboard + Bus Availability Performance Audit

## Production incidents addressed

Render production logs on 15 August 2026 showed cold company-admin requests at approximately 3.7s for Overview, 9.0s for Setup Guide, 5.9s for Manifests, 3.9s for Archive and 2.3s for Revenue. A Trinity Express bus checkout also spent about 1.64s in the availability phase before the existing ~0.76s authoritative seat-hold transaction.

## v1.6.86 corrections

- Company Overview now hydrates only listings, bookings, support cases and notifications—the records actually rendered by its headline stats/recent-activity UI.
- Setup Guide now has its own explicit service-aware dataset instead of silently falling back to the broad Overview snapshot.
- Passenger Manifests no longer load standalone passenger, ticket-scan, bus-reservation and seat-assignment collections that the live manifest projector does not consume.
- Company Revenue now loads booking/payment/refund/wallet data without opening settlement risk, reconciliation, invoice and offline-sales datasets.
- Reports is a lightweight navigation/export surface rather than a full finance snapshot.
- Company Archive now queries only common archive records plus the active company service family (bus, hotel, flight or local transport), with bounded concurrency increased from 4 to 8. Restore authorization retains the complete existing allow-list.
- Bus segment inventory now has a query-shaped `{ scheduleId, segmentId, seatNumber }` compound index in addition to the unique seat-first index.
- The live availability read no longer asks MongoDB to sort segment inventory rows; UI order is reconstructed from the immutable seat definitions.
- The authoritative seat claim + hold transaction remains unchanged and atomic.
- v1.6.85 amenity exact-fit layering, notification light-mode contrast and quiet routine Pesapal warm-refresh logging are preserved.

## Expected effect

The largest dashboard regression was query fan-out, not rendering. Setup Guide previously opened the broad Overview dataset because it had no page map at all; Archive scanned models belonging to unrelated service categories. v1.6.86 removes those unnecessary reads. Exact production latency still depends on Atlas/Render network conditions and the amount of company data, so post-deploy logs remain the source of truth.

The bus availability index is created by the existing Render pre-deploy `db:indexes` step before the new service receives traffic.

## Validation

Run the complete release gates and dependency-backed unit/audit checks on the extracted final archive. The focused contracts for this release are `check:fast-runtime-ui` and `check:checkout-speed`.
