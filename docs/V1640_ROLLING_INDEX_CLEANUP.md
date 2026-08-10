# Classic Trip v1.6.40 — Mongo index and rolling conflict stabilization

## Runtime issues addressed

The reported startup warning came from `PlatformActivity.expiresAt` declaring a normal field index and a TTL index on the same key. v1.6.40 removes the field-level `index: true` and keeps only the explicit TTL index with `expireAfterSeconds: 0`.

The rolling logs also proved two deterministic full-window conflicts: rule 11 is occupied by rule 10-generated departures and rule 14 is occupied by rule 13-generated departures. The worker was correctly refusing double-booking, but repeatedly rescanning all missing dates was wasteful and noisy.

## New rolling behavior

- A conflict on only some dates stays date-specific; later free dates continue materializing.
- If every missing date is blocked by recurring-rule-generated departures, the rule receives `materializationBlockerCode=vehicle_schedule_conflict_window`, `materializationRequiresAction=true`, the blocker rule IDs, a human-readable reason, and a six-hour safety expiry.
- Active persistent blockers are excluded from routine worker scans, so the same 30 dates are not queried and logged every repair cycle.
- When a referenced recurring rule is edited/paused/cancelled, dependent full-window blockers are cleared and an outbox materialization request is queued immediately.
- The Partner Admin recurring-rule table shows `action needed` and the blocking rule IDs.

## Important operational rule

Classic Trip still never bypasses real vehicle overlaps. Changing or pausing a recurring rule does not automatically delete already-created dated departures. If those dated departures are still meant to exist, assign another vehicle/time to the blocked rule. If they are obsolete, archive/cancel the relevant dated departures as part of resolving the conflict.

## Validation

- v1.6.40 focused rolling/index gate: 10/10
- JavaScript syntax: 618/618
- EJS dependency-free validation: 131/131
- Release consistency: 11/11
- Final regression: 42/42
- Production readiness: 76/76
- Dashboard workflow relationships: 22/22
- Dashboard service coverage: 68/68
- VIP/dashboard CRUD: 170/170
- Flight/Taxi: 110/110
- Backend end-to-end: 20/20
- Partner registration/identity: 9/9

The complete `npm run verify` progressed through the dependency-free checks and stopped only when `check-platform-experience-final.js` attempted to import the real `ejs` package from `node_modules`; this clean artifact intentionally contains no dependencies. Run `npm ci` locally before `npm run release:check`.
