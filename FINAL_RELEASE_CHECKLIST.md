# Classic Trip Final Release Checklist

Use this checklist for version 1.6.0.

## 1. Clean installation

```bash
rm -rf node_modules
npm cache verify
npm ci
```

Do not delete `package-lock.json`. `npm ci` must install exactly the dependency tree recorded in the lockfile.

## 2. Configure the environment

Copy `.env.example` to `.env`, then replace every placeholder. Production must use public HTTPS URLs, an Atlas/replica-set MongoDB deployment, Redis, Cloudinary, live payment credentials, SMTP, WhatsApp delivery credentials, and a strong unique session secret.

Recommended database settings are already documented in `.env.example` and `render.yaml`. Keep runtime automatic index creation disabled.

## 3. Apply database indexes

```bash
npm run db:indexes -- --dry-run
npm run db:indexes
```

The dry run reports replacements without modifying Atlas. Review it, then run the apply command after every model/index change and before switching production traffic to the release.

## 4. Verify source, runtime, tests, and dependencies

```bash
npm run release:check
```

This executes the complete verification suite and then runs:

```bash
npm audit --omit=dev --audit-level=high
```

Do not release while a high or critical production vulnerability remains unresolved. Review moderate findings according to reachability and business risk.

## 5. Validate the live production environment

```bash
NODE_ENV=production npm run release:launch
```

This validates required secrets and provider configuration, tests MongoDB and Redis connectivity, confirms transaction support, and checks production routing expectations.

## 6. Start web and worker processes

Web:

```bash
NODE_ENV=production npm start
```

Worker:

```bash
NODE_ENV=production npm run worker
```

Only the worker should run scheduled jobs. Keep `ENABLE_JOBS=false` on the web process and `ENABLE_JOBS=true` on the worker.

## 7. Smoke tests after deployment

Confirm all of the following:

- `/health` returns HTTP 200.
- `/ready` returns HTTP 200 and `database: "ready"`.
- Login, signup, partner onboarding, recovery, and support panels work and remain readable in both themes.
- The home service tabs replace the visible form with the correct bus, stay, flight, taxi, tour, rental, or cargo inputs.
- The 12 px top navigation spacing remains and is filled by the same page background without a black or empty strip.
- Flight, Local Taxi and PWA install containers are opaque in dark mode.
- Clicking service types does not shift the hero left or right.
- Phone hero statistics are hidden while desktop statistics remain visible.
- Featured buses show two phone rows with one full card column and about one quarter of the next column visible.
- Every marketplace section can toggle between its unique card layout and compact bars; bars use one column on phones and two on desktop.
- More controls appear only when additional database listings are available and load real records.
- Login, logout, password reset, verification, and role redirects work.
- A published bus listing with a live departure shows the booking/payment action.
- Repeated Proceed to payment requests reuse the same active matching draft; genuine seat conflicts refresh availability instead of silently bypassing inventory protection.
- A return search shows valid reverse departures regardless of matching clock time.
- Seat holds, payment callback/IPN, ticket generation, and booking history work.
- Company schedules, live seat maps, manifests, archives, stays, flights, taxi, tours, car rentals, cargo, promotions, and blog administration open without 404/500/503 responses.
- Redis and MongoDB metrics do not show sustained pool saturation or increasing wait queues.
- Security/audit events reach the configured log platform or SIEM.

## 8. Rollback readiness

Before launch, record the previous deployed commit/archive, preserve a verified database backup, and confirm that application rollback does not require reversing destructive migrations. The release migrations in this project provide dry-run commands; execute dry-run first whenever historical data must be normalized.

## v1.6.0 focused checks

- [ ] Standard Ticket and VIP Ticket appear side by side and filter to matching departure classes.
- [ ] Return Ticket remains selected and visible when a route has no matching reverse departure.
- [ ] The normal partner departure form defaults to a rolling 30-day window.
- [ ] A new far-end date is materialized on the next daily worker run.
- [ ] Bus setup starts with terminal creation and hotel setup starts with stay-listing creation.
- [ ] Tour, car-rental and cargo partners see only company-scoped quick actions.
- [ ] Public stay choices use room cards and partner room operations use the room-unit grid on desktop, tablet and phone widths.
- [ ] Customer, promoter, support, finance, operations, content, employee and driver dashboards expose only role-owned sections and actions.
- [ ] Promoter referral-link creation and driver trip-update, incident, handover and profile actions persist successfully.
- [ ] Keyboard focus is visible and dashboard dialogs trap focus, close with Escape and restore focus.
- [ ] `npm run check:platform-experience`, `npm run check:ticket-rolling-setup` and the complete `npm run release:check` pass.
