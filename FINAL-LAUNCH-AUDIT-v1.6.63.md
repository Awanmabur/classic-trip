# Classic Trip v1.6.63 — Public Performance & Scanner Hardening

## Why the logged requests were slow

The anonymous Home and Search paths were still capable of building the full operational marketplace snapshot. That snapshot included booking-only collections such as seat inventory, vehicles, room units and room-night rows, with collection limits reaching tens of thousands of records. Search also re-enriched listings and route/fare summaries on each query. Those operations were unnecessary for public discovery and could turn a cold Atlas read into multi-second guest requests.

The `/xmlrpc.php` request is not a Classic Trip route. It is a common WordPress/PHP scanner probe. In v1.6.62 it reached the normal middleware chain and was rejected by CSRF, creating misleading warning noise and consuming session/security middleware work.

## v1.6.63 changes

- Added a dedicated lightweight public discovery snapshot for Home, Search, Services, Routes, Companies, Company Profile, Promoters and bus listing previews.
- Public discovery no longer bulk-loads seat rows, vehicle rows, room units or room-night inventory.
- Booking, checkout, selected-departure seat availability and exact fare calculation remain on authoritative scoped/live reads.
- Reuses immutable route and fare snapshots already stored on upcoming departures, then queries only route/fare records not covered by those snapshots.
- Added a gzip-compressed Redis discovery snapshot so Render processes can reuse the last known-good public index across requests/process restarts.
- Added stale-while-revalidate behavior: after a known-good public snapshot exists, guest requests are served immediately while refresh occurs without blocking that request.
- Added per-snapshot caching of enriched public catalog cards so Search/Home do not repeat the same route/fare derivation for every request.
- Home now enriches each listing once and derives company/route summaries from those cached objects.
- Bus listing preview reuses the lightweight public snapshot. Only an explicitly selected departure calls the authoritative live seat/fare service.
- `/xmlrpc.php`, WordPress admin/login/config probes, `.env` and `.git` probes are rejected with a cheap 404 before body parsing, sessions, monitoring and CSRF middleware.
- Added production controls:
  - `DISCOVERY_CACHE_TTL_MS=300000`
  - `DISCOVERY_CACHE_STALE_MS=21600000`

## Performance target

The user-supplied slow logs were:

- Search: 8,234 ms
- Home: 7,554 ms
- Bus listing preview: 2,302 ms

Interpreting “150% faster” as 2.5× throughput (about 60% lower response time), the equivalent response-time targets are approximately:

- Search: <= 3,294 ms
- Home: <= 3,022 ms
- Bus listing preview: <= 921 ms

The release removes the dominant avoidable data/CPU work on these paths. Exact production latency still depends on Render instance load, Atlas network latency, Redis availability and cache warmth, so these targets must be confirmed from deployed request logs rather than claimed from a source-only sandbox.

## Validation completed

- v1.6.63 public performance contracts: 17/17
- Release consistency: 11/11
- JavaScript syntax: 653/653
- EJS syntax: 131/131
- Backend end-to-end static contracts: 20/20
- Historical speed/end-to-end contracts: 13/13
- Performance architecture contracts: passed
- Deep-cleanup regression contracts: 26/26
- Dependencies and devDependencies are identical to v1.6.62.

The registry-backed `npm ci`/audit could not be repeated in this sandbox because npm stalled before producing output. No dependency package or version was changed in v1.6.63.

## Deployment

No database migration or reseed is required. Deploy the source normally. Redis is strongly recommended in production because it is used to share the public discovery snapshot and preserve fast known-good data between web process lifecycles.
