# Classic Trip Final Deep Cleanup

Date: 26 July 2026

## Scope

This release preserves the approved Classic Trip reference UI and corrects the remaining Super Admin, mobile, authentication, dark-mode and performance defects without introducing a new design.

## Corrected UI behaviour

- All nine Super Admin **Partner Network** pages now use one explicit non-overlapping page contract: one hero, one data card, one uniform card header, one contained table area and one padded empty state.
- The mobile dashboard outer gutter is reduced to four pixels per side and aligned with the opened menu drawer.
- Partner tabs remain horizontally scrollable on narrow phones rather than compressing or overlapping.
- Dashboard cards, split items, tables and forms are constrained to their own grid cells.
- Inputs, selects, textareas and search controls retain the approved neutral focus appearance; the added light-blue typing border and tint have been removed.
- Auth error notices have readable contrast in light and dark themes.
- The notification dock now uses the active theme instead of an always-black panel.

## Dark-mode root defect

The approved dashboard stylesheet contained a print-oriented rule that was active during normal screen rendering:

`body { margin: 28px; color: #111827; background: #fff; }`

The final scoped stylesheet now restores the actual dashboard body geometry and theme variables. This fixes the large dashboard margins and dark text/icons on dark backgrounds while leaving the approved component design unchanged.

## Authentication feedback

- Incorrect email/phone/password now creates a visible error flash.
- Locked, pending, inactive, validation and rate-limited account states show clear messages.
- The login page uses `Cache-Control: no-store` so a new flash message is not hidden by a cached page.
- Browser-facing rate limits redirect back with flash feedback rather than returning a raw JSON error page.
- Existing success, logout, signup, reset and verification messages remain supported.

## Performance improvements

- Login lockout count and user identity lookup now run concurrently.
- Device-session, login-audit and security-audit writes run concurrently while remaining durable.
- Authenticated GET requests reuse a short 15-second account-state check; mutating requests force a fresh account check.
- Dashboard snapshots use in-flight request deduplication, a short TTL cache and stale-while-revalidate.
- Successful domain writes invalidate dashboard snapshots automatically.
- The platform snapshot begins prewarming at startup, and the destination dashboard starts prewarming during successful login.
- Every response receives `X-Request-ID`; slow responses expose `Server-Timing` and are logged when they exceed 1.2 seconds.

## Services retained

- Bus marketplace and operations
- Hotel marketplace and operations
- Flight Agent sales, ticketing and support
- Local Mobility, boda riders, car drivers, fleet/rental owners and mobility companies
- Platform-controlled pricing and dispatch
- Real taxi route geometry, tracking, pickup PIN, cancellation/refunds and safety cases
- Payments, commissions, settlements, role permissions, tenant isolation and CSRF controls

## Production configuration

The following optional environment values are documented:

```env
DASHBOARD_SNAPSHOT_TTL_MS=5000
DASHBOARD_SNAPSHOT_STALE_MS=30000
```

Use `MONGO_DB_NAME=classic-trip` or include `/classic-trip` in the MongoDB URI.

## Verification

- JavaScript syntax: 509/509
- EJS templates: 126/126
- Deep cleanup checks: 26/26
- Reference UI: 174/174
- Spacing/flash: 19/19
- Flight Agent/Local Mobility: 110/110
- Dashboard service coverage: 68/68
- Production architecture: 6,588/6,588
- Bus/Hotel end-to-end: 57/57
- Bus/Hotel architecture: 95/95
- UI consistency: 16/16
- Final regression: 42/42
- Route security, CSRF and architecture/security: passed

## Connected-environment checks still required

Dependency installation timed out in the artifact environment, so live Jest execution, MongoDB transactions, payment/refund sandboxes, flight suppliers, route-provider capacity, real GPS updates, email/SMS/WhatsApp delivery, DAST and independent penetration testing must be run in staging before public launch.
