# Classic Trip root-cause repair — 2026-07-31

This repair addresses the MongoDB startup/pool failures, dashboard slowness, reverse/return-trip discovery, and live bus departure bookability without changing the approved UI structure.

## Root causes corrected

1. **MongoDB pool starvation across concurrent snapshots**
   - Company/admin/catalog snapshots previously limited reads per snapshot, not across the Node process. Multiple simultaneous page requests could therefore overflow a small Atlas pool.
   - Dashboard/catalog heavy reads now share a process-wide admission gate that reserves pool capacity for authentication, sessions and writes.
   - Idempotent repository reads retry one transient wait-queue/server-selection/network failure; writes are deliberately not automatically retried.
   - Startup uses bounded retries and hard minimum connection/queue timeout floors, so an old 5-second `.env` value cannot reintroduce the previous behavior.
   - High-value compound indexes were added for schedules, segment inventory, notifications, invitations and verification reviews.

2. **Valid return trips hidden/rejected**
   - Return discovery now starts from actual future live departures (`published`, `boarding`, `delayed`) and then verifies that their scheduled route segment travels from the outbound destination back to the outbound origin.
   - There is no comparison between the return clock time and the outbound clock time. A same-time return departure is eligible as long as it is still in the future and otherwise bookable.
   - Final round-trip validation no longer assumes RouteStop IDs are shared by reverse routes. It validates reversed branch/location identity, while retaining the old same-stop-ID case for compatibility.

3. **Published live bus shown as “Coming soon”**
   - For bus listings, the public source of truth is now a live future departure plus inventory, not a stale `Listing.bookable=false` flag.
   - Booking engines still reject drafts, archived listings, non-public departures, expired departures and unavailable inventory.
   - The legacy bus-publication repair job now restores `bookable=true` only when a live future departure and available segment inventory actually exist, rather than reintroducing a false flag.

4. **Security hardening found during the general audit**
   - User-controlled `next`/`Referer` redirect targets are constrained to safe local paths.
   - Multer is aligned to 2.2.0 and multipart requests now have bounded files, fields, parts, field size and header pairs.
   - Existing CSRF, role/ownership, route-security, MFA, rate-limit, audit/security-event and CSP/Helmet checks were retained.

## Required local setup after replacing the project

From Git Bash in the project directory:

```bash
rm -rf node_modules
cp -n .env.example .env
npm ci
npm run db:indexes
npm run check:runtime-resilience
npm run verify
npm start
```

If `.env` already exists, do **not** overwrite its secrets. Make sure it contains/uses at least these database performance values (the code also enforces safe minimums):

```env
MONGO_SERVER_SELECTION_TIMEOUT_MS=30000
MONGO_CONNECT_TIMEOUT_MS=30000
MONGO_SOCKET_TIMEOUT_MS=90000
MONGO_WAIT_QUEUE_TIMEOUT_MS=30000
MONGO_MIN_POOL_SIZE=1
MONGO_MAX_POOL_SIZE=24
MONGO_MAX_CONNECTING=4
MONGO_CONNECT_RETRY_ATTEMPTS=5
MONGO_CONNECT_RETRY_DELAY_MS=750
MONGO_AUTO_INDEX=false
MONGO_IP_FAMILY=4
DASHBOARD_DB_READ_CONCURRENCY=4
MONGO_READ_CONCURRENCY=6
```

`npm run db:indexes` is important because runtime auto-indexing is intentionally disabled; building indexes during normal web requests can itself create startup/dashboard pressure.

## Verification performed in the repair workspace

- JavaScript syntax: 546 files passed.
- Static/system/security/route/EJS/workflow checks: 56 scripts passed, 0 failed (runtime-module loader excluded because this isolated repair environment could not fetch/install npm packages).
- Root-cause resilience audit: 15/15 passed.
- The interrupted sandbox dependency install was removed; `node_modules` is not included in the final archive.

## Infrastructure boundary

The source contains application-level security controls, security events and audit logs. External controls such as a cloud/WAF IDS/IPS, host EDR and SIEM ingestion rules must be verified in the actual hosting/network environment; they cannot be proven from a source ZIP alone.
