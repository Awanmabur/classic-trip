# Classic Trip v1.6.37 — Auth UI and monitoring performance

## Login
- The Tip banner now sits in a dedicated grid stack with an 18px gap above it. This does not depend on margin collapsing or theme overrides.
- Google login/signup use a local four-color Google G SVG and continue to link to the existing `/auth/google` Passport OAuth flow.

## Monitoring and page speed
- Visitor activity is queued and written to MongoDB in `insertMany` batches instead of one insert per request.
- The Monitoring page uses one `$facet` aggregation rather than many independent count/aggregate queries.
- Monitoring results have a short 15-second cache with in-flight request deduplication.
- The Super Admin Monitoring page no longer hydrates the full overview dashboard dataset behind the analytics view.
- Admin/Company notification pages use smaller page-specific snapshots.
- Monitoring now exposes average page response time and a slowest-pages table to identify the next performance bottlenecks from real traffic.
