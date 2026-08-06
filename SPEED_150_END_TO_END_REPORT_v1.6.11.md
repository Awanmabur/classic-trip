# Classic Trip v1.6.11 — End-to-End Speed Pass

This release targets a substantially faster perceived and server-side experience across public marketing pages and dashboards while retaining the v1.6.7-safe route/preview/rolling-departure behavior.

## Platform-wide changes

- Public read-only pages no longer create a CSRF-backed session for every signed-out visitor.
- Empty flash-message reads no longer dirty and persist anonymous sessions.
- Anonymous marketing HTML can be served through short shared caching with stale-while-revalidate and stale-if-error protection.
- EJS production view compilation is cached and static compression now uses an explicit efficient threshold/level.
- Country-market configuration is calculated once per process instead of once per request.
- The fully derived homepage catalog is cached separately from the database snapshot, preventing repeated mapping and aggregation of thousands of rows.
- The web process remains free of background read-model maintenance; the derived catalogue warms lazily on the first public request and then uses stale-while-revalidate.
- The large dashboard workspace bundle is loaded asynchronously after markup, so it no longer holds DOMContentLoaded.
- Below-fold public sections use browser content visibility to skip layout/paint work until needed.
- Mobile bottom navigation now has a 32–34px outer radius and 18–19px item radius, with lighter transitions and paint containment.

## Important expectation

“150% speed” is treated as a performance target, not a guaranteed fixed benchmark: real speed still depends on MongoDB/Redis latency, hosting CPU, network quality, data volume, and third-party fonts/icons. The release removes major application-side bottlenecks that affected every route.
