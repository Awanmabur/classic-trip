# Classic Trip Final Release Checklist

Use this checklist for version 1.6.33.


## Current focused validation

```bash
npm run check:v1633-final-stability
npm run check:v1632-return-notifications-contact
npm run check:v1632-domain-rolling-db-search
```

After deployment, confirm:

- preview order is Ticket class and Journey first, then Route & travel;
- selecting VIP leaves only VIP active and does not silently reselect Standard;
- desktop preview fonts remain compact while phone controls are readable but not oversized;
- desktop bar images are narrower and align smoothly from top to bottom;
- phone bar dimensions remain unchanged while bar copy is slightly larger;
- the two badges inside bar images are smaller; and
- the top-right green availability badge is readable in light mode.

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
- [ ] After a departure time passes, a replacement far-end date is materialized on the next rolling worker pass (normally within 15 minutes when the worker is healthy).
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

## Final go-live sequence for v1.6.33

1. Back up the production MongoDB database before migrations or index reconciliation.
2. Confirm all production secrets and callback URLs are configured in the hosting environment; never upload a local `.env` file.
3. Run `npm ci` on a clean checkout.
4. Run `npm run release:check` and do not deploy if any check fails.
5. Run all migration commands in dry-run mode first. Apply only migrations whose dry-run reports changes you expect.
6. Run `npm run db:indexes` once against production before starting traffic after schema/index changes.
7. Seed the super admin only if the production account does not already exist; do not reset an existing production password unintentionally.
8. Start the web process and the dedicated worker as separate services. Keep web background jobs disabled when the worker is enabled.
9. Verify `/ready` returns healthy before routing traffic.
10. Perform one real Standard one-way booking and one VIP/return flow through payment, ticket issue, and persisted seat state.
11. Verify payment callbacks/IPN/webhooks use the live HTTPS domain and the live provider credentials.
12. Verify email/SMS/WhatsApp/push integrations that are enabled for production.
13. Verify Cloudinary uploads, authentication, password reset, partner/admin dashboards, manifests, archive/restore, and mobile/PWA behavior.
14. Watch web and worker logs for MongoDB disconnects, repeated rolling conflicts, cron missed executions, payment webhook errors, or 5xx responses before announcing the launch.
15. After deployment, hard-refresh/service-worker refresh on phone and desktop so clients receive the v1.6.33 asset cache.

### Production configuration blockers

- `TAXI_ROUTING_API_URL` must be a real public HTTPS routing endpoint; production defaults to live-routing required.
- `PUSH_ENABLED=true` requires valid `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, and a valid subject.
- Render web and worker services must use the same routing and push configuration.
- `OUTBOX_BATCH_SIZE` is the correct worker batch-size variable.

## SEO and AI discovery launch steps — v1.6.33

1. Use `https://www.classictrip.org` as the canonical production origin. The application redirects production HTTP requests to this HTTPS origin.
2. In Google Search Console, add `https://www.classictrip.org` as a URL-prefix property (or verify the whole domain by DNS). If using the HTML-tag method, copy only the `content` value from `<meta name="google-site-verification" content="...">` into `GOOGLE_SITE_VERIFICATION`.
3. In Bing Webmaster Tools, add `https://www.classictrip.org`. If using Meta Tag verification, copy only the value inside `content="..."` from the `msvalidate.01` tag into `BING_SITE_VERIFICATION`.
4. IndexNow does not issue a private console token. v1.6.33 uses this generated site key: `260abf506c26c3c6742128f6978addf9c0e49c04d3245fa3784263f66f7fd374`. Keep it as `INDEXNOW_KEY` and confirm `https://www.classictrip.org/260abf506c26c3c6742128f6978addf9c0e49c04d3245fa3784263f66f7fd374.txt` displays exactly that key after deployment.
5. Keep `SEO_ALLOW_AI_SEARCH=true` so supported AI search/user crawlers can reach public pages. Keep `SEO_ALLOW_AI_TRAINING=false` unless you deliberately want training crawlers.
6. After deployment, confirm these return HTTP 200: `https://www.classictrip.org/robots.txt`, `/sitemap.xml`, `/sitemaps/static.xml`, `/sitemaps/listings.xml`, `/sitemaps/companies.xml`, `/sitemaps/blogs.xml`, `/llms.txt`, `/llms-full.txt`, and `/ai-index.json`.
7. Submit `https://www.classictrip.org/sitemap.xml` in Google Search Console and Bing Webmaster Tools.
8. Run `npm run seo:submit-indexnow` once after the production domain and IndexNow key endpoint are live.
9. Test the home page, one service landing page, one listing, one verified company and one blog post with Google URL Inspection / Rich Results testing.
10. Confirm `/search?...`, login, dashboards, checkout, tickets, private tracking and API paths are not indexed.
11. Run PageSpeed Insights/Core Web Vitals on the home page and a representative listing after production images and analytics are live.

## Runtime stabilization checks — v1.6.33

- Open Notifications from Company, Customer, Employee/Driver, Promoter and one platform-admin dashboard. Confirm the URL changes to the role-specific notification route and the live list loads.
- From Home, choose a bus From/To pair that is not the first route of its company card, choose a date with a live departure, and confirm Search returns that route.
- On `/search`, switch Service to Bus and confirm the destination selector only offers destinations valid for the selected origin.
- For existing conflicted rules such as rule-8 / rule-11 / rule-14, fix the real vehicle/document conflict instead of forcing publication. v1.6.33 keeps other free rolling dates eligible.

## Rolling-departure production check — v1.6.33

1. Confirm the `classic-trip-worker` service is running, has `ENABLE_JOBS=true`, and uses `JOB_MATERIALIZE_SCHEDULES=*/15 * * * *`. The web service should keep background jobs disabled when the dedicated worker is healthy.
2. Create or inspect one active rolling rule with a 30-day window and a valid vehicle/template.
3. Count its future dated departures before today’s departure time passes.
4. After that departure time passes, the next materializer pass shifts the window forward immediately and creates the missing far-end date instead of waiting for the next calendar day.
5. With the 15-minute schedule, the replacement should normally appear within 15 minutes of the departed time, provided MongoDB is available and there is no current vehicle overlap/publication blocker.
6. A vehicle-overlap blocker now expires after a 15-minute cooldown and automatically retries. If the real overlap still exists, it will block again; correct the vehicle/time rather than creating duplicates.
7. Restart the worker and verify the same dated departures remain persisted without duplicates.

## DB-backed public search check — v1.6.33

1. Home bus From/To, stays destination, flights, tours, rentals, cargo, and other public marketplace location selectors are populated from published database data.
2. The general marketplace From/To selectors and public Routes directory selectors use the same published DB inventory.
3. Flight origin/destination selectors are populated from active airport records returned by the flight airport API.
4. If a selector is empty, publish/seed the corresponding route, airport, location, stay/listing or service data; do not hard-code the missing city into the template.
5. Taxi ride pickup/destination remains an autocomplete/current-location control because exact coordinates are required, but accepted suggestions come from the DB-backed Places service rather than accepting arbitrary route inventory values.


## Return ticket, push notification, contact and domain launch checks — v1.6.33

1. Use `https://www.classictrip.org` as the public production origin. Add both `www.classictrip.org` and `classictrip.org` as custom domains in Render/DNS, and redirect the apex domain to `https://www.classictrip.org` so there is only one canonical host.
2. Run `npm run push:generate-keys` locally once. Copy `PUSH_VAPID_PUBLIC_KEY` and `PUSH_VAPID_PRIVATE_KEY` into the Render web service secrets. Keep the private key out of Git. Set `PUSH_VAPID_SUBJECT=mailto:support@classictrip.org`.
3. Confirm the worker receives the same VAPID keys from the web service and that `PUSH_ENABLED=true` on both web and worker.
4. Sign in as a customer, open Notifications, click **Enable push**, allow browser notifications, then click **Test push**. The test must appear in the device notification tray before launch.
5. Send an admin campaign using `in_app,push,email`. Confirm it appears in the recipient notification center even if that recipient has not enabled browser push.
6. Mark one notification read, reload, and confirm it remains read. Then use **Mark all read** and confirm the unread badge becomes zero.
7. Test a bus Return Ticket on a route with an independently-created reverse route. The return list must show every valid future reverse departure even when its time does not match the outbound arrival estimate, its reverse route has different stop IDs, or the reverse service uses a different Standard/VIP vehicle class. Select a return departure, select the same passenger count of return seats, continue through checkout, pay, and confirm both booking legs are persisted.
8. Verify the global floating Contact button on desktop and phone. It must open vertically to: Join WhatsApp group, WhatsApp chat/call entry for `+256781977217`, and direct call to `+256781977217`.
9. Confirm these environment values on Render: `SUPPORT_PHONE=+256781977217`, `SUPPORT_WHATSAPP=+256781977217`, and `WHATSAPP_GROUP_URL=https://chat.whatsapp.com/LUcqaMgUlfBLDmE1GICVAI?s=cl&p=a&ilr=1`.
