# Classic Trip Final Release Checklist

Use this checklist for version 1.6.15.


## v1.6.15 focused validation

```bash
npm run check:v1615-preview-worker-listing
```

After deployment, confirm:

- preview route/travel selectors appear above Ticket class and Journey;
- preview flash messages are red rounded rectangles;
- a company listing row shows Partner, Inventory, Country route, Badge and Price in separate aligned columns;
- startup logs label MongoDB connections as `process=web` and `process=worker`;
- a MongoDB outage produces one rolling-queue pause warning rather than one warning per rule; and
- a vehicle overlap remains blocked until its recurring rule is corrected and resumed.

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

For local development or a single process service, the normal launcher starts both the web server and worker:

```bash
npm start
```

Do not run rolling jobs inside `src/server.js`. The web fallback is disabled by default; use the dedicated worker launched by `npm start`, or explicitly set `WEB_ROLLING_FALLBACK=true` only when no worker process exists.

For a deployment with a dedicated worker service, use:

Web:

```bash
NODE_ENV=production RUN_BACKGROUND_WORKER=false ENABLE_JOBS=false npm start
```

Worker:

```bash
NODE_ENV=production ENABLE_JOBS=true npm run worker
```

Only the dedicated worker should run scheduled jobs and own the rolling-departure queue. Keep `WEB_ROLLING_FALLBACK=false` on a web service that has a separate worker; set it to `true` only for a genuinely standalone web process with no worker.

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
- Every marketplace section can toggle between its unique card layout and compact bars; phone bars retain the approved layout, while desktop bars use natural content height and a fixed compact 190 × 150 px image.
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

## v1.6.14 focused checks

- [ ] Phone bar layout and dimensions match the approved pre-v1.6.14 phone presentation.
- [ ] Desktop bar images remain exactly 190 px wide × 150 px high while the text side grows naturally for additional route chips.
- [ ] No route chip is hidden, clipped or placed behind another bar element, and compact bars do not contain unnecessary vertical gaps.
- [ ] `DRIVER - FRONT` has a visible divider and an 18 px gap before the first seat row.
- [ ] The complete dashboard cabin and aisle remain centered for symmetric and asymmetric templates such as 2×2, 2×3 and 3×2.
- [ ] A seat with a booking reference, ticket number, or occupied/taken status is red in both dashboard and public preview views.
- [ ] Only blocked, disabled, unavailable and maintenance seats are orange.
- [ ] Public cards, booking views, dashboards, manifests, archives and PDFs show `Origin ⇄ Destination` rather than origin `to` destination or a one-way arrow.
- [ ] `ScheduleRule` records persist blocker code, reason, failure list and blocked-until time in MongoDB.
- [ ] Repeated scans do not extend an already active vehicle-conflict blocker.
- [ ] The scheduled `materializeSchedules` callback queues eligible rules and completes well below the 45-second deadline.
- [ ] `npm run check:v1614-bars-seats-routes-rolling` passes 14/14.
- [ ] After `npm ci`, `npm run release:check` passes including the EJS/Mongoose runtime groups and production dependency audit.

## v1.6.7 focused checks

- [ ] Starting with one existing Draft departure and 29 missing dates, the worker logs `created=1`, `skipped=0`, and a decreasing `pending` value on successive batches.
- [ ] The worker does not log `Cannot read properties of undefined (reading 'findOne')` as a permanent skipped date or pause the queue because of that internal runtime error.
- [ ] A missing operating permit keeps every generated date in Draft but does not stop the rolling window from reaching 30 dated departures.
- [ ] Saving an active rolling rule returns after creating one dated departure; the remaining dates are produced only by the worker in low-priority batches.
- [ ] The web process stays responsive while the rolling month is materialized, and dashboard cache invalidation occurs after the drain settles.
- [ ] A missing operating permit creates Draft dates without a tight retry loop; publication succeeds after a valid, unexpired permit is added and the repair pass runs.
- [ ] Changing boarding/drop-off stops keeps the preview fare visible, returns live availability within the bounded timeout, and does not load all rolling-date Seat rows.
- [ ] Proceeding from a seat hold to payment reuses the selected departure snapshot and opens without a second full marketplace read.
- [ ] Bars show the service badge at image bottom-left, rating/New at bottom-right, a wider image, and one-line phone description.
- [ ] Header, body, footer and mobile bottom navigation have the same outer width.
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


## v1.6.12 ultra-speed checks

- [ ] Render web service has `ENABLE_JOBS=false`, `RUN_BACKGROUND_WORKER=false`, and `WEB_ROLLING_FALLBACK=false`.
- [ ] Render worker alone has `ENABLE_JOBS=true`; Redis is connected and required.
- [ ] Mongo wait queue, server selection, connect and socket values are 2500/4000/5000/15000 ms, not the old 30000/90000 ms values.
- [ ] Login content appears immediately even when Google Fonts/CDN resources are slow or unavailable.
- [ ] Hovering/touching a listing card makes its preview navigation noticeably faster.
- [ ] Preview and payment do not trigger a complete marketplace/seat-history read.
- [ ] Each dashboard URL loads only its active page and does not serialize unrelated role data.
- [ ] The dashboard menu/theme/sidebar search work immediately while the CRUD workspace loads after first paint.
- [ ] During a temporary Atlas interruption, cached dashboards/listings remain readable and requests fail within seconds rather than hanging for minutes.
- [ ] Superseded by v1.6.14: verify phone remains approved and desktop uses natural height with a fixed 190 × 150 px image.
- [ ] `DRIVER - FRONT` has visible spacing and the seat-map cabin is centered.
