# Classic Trip Complete Dashboard Service Network — 25 July 2026

This correction restores the dashboard coverage that was missing after Bus and Hotel. The Super Admin, partner and operational dashboards now represent the complete Bus, Hotel, Flight Agent and Local Mobility architecture.

## Super Admin coverage restored

- Added Flight Agents & Supply and Local Mobility to **Service Categories**.
- Added dedicated Flight Agents, Boda Riders, Car Drivers, Fleet & Rental Owners and Mobility Companies workspaces.
- Added driver/rider verification, vehicle compliance, dispatch/live rides and restricted safety/incident workspaces.
- Partner directory tabs and counts now cover every supported partner model, not only Bus and Hotel.
- Flight-agent records link to agency verification and platform supplier controls.
- Mobility partner records link to KYC, driver verification and vehicle compliance.
- Driver and vehicle review forms use the actual secure backend contracts and selected verified vehicle relationships.

## Role-specific partner dashboards

- Individual boda riders and car drivers no longer see Team or fleet-wide management. Their menu is limited to their own vehicle, driver profile, availability, assigned rides, safety, earnings and payouts.
- Fleet/rental owners and mobility companies retain staff, fleet and driver management for their own tenant.
- Flight agencies retain agent search, quote, booking, traveler, ticket, change/refund, support, commission and settlement functions without airline-operation controls.
- Existing Bus and Hotel dashboards remain unchanged and complete.

## Verification

- Dashboard service coverage and render contracts: **68/68**
- JavaScript syntax: **502/502**
- EJS templates: **125/125**
- Production architecture: **6,555/6,555**
- Flight Agent and Local Mobility: **110/110**
- Platform layout and Super Admin: **18/18**
- Route security, CSRF, entity relationships, dashboard scope, UI consistency and final regression: **passed**

---

# Classic Trip Final Platform Spacing and Super Admin Repair — 25 July 2026

This build is the final correction of the Partners page spacing, the Super Admin `/admin` rendering failure, the duplicate Mongoose TTL-index warning and the platform-wide margin, gap, padding and responsive rhythm.

## Runtime corrections

- Fixed the `/admin` 500 caused by `dynamic-service.ejs` referencing a `sectionLocals` variable that is unavailable inside a nested EJS include.
- The nested Flight and Local Mobility Super Admin controls now receive explicit `dashboardData`, `platformConfig`, `csrfToken` and `cspNonce` locals.
- Added a dependency-free render smoke that executes both nested service templates and verifies their complete Super Admin control sections render.
- Removed the duplicate `DriverLocation.expiresAt` schema index declaration while retaining the intended TTL index.
- MongoDB now selects `classic-trip` automatically when `MONGO_URI` omits a database path and `MONGO_DB_NAME` is not configured, preventing accidental use of Atlas's `test` database.

## Platform-wide spacing and responsive corrections

- Added the requested bottom margin under the public Partners banner.
- Normalised page rhythm across marketing, service catalogues, Flight, Local Mobility, booking, lookup, auth/onboarding and every role dashboard.
- Reduced inconsistent oversized controls while preserving the approved rounded Classic Trip design.
- Standardised form gaps, field spacing, card internals, notices, tables, action groups and mobile padding.
- Kept View and Book actions aligned in one row on catalogue and partner cards.
- Prevented mobile dashboard headings and helper text from disappearing or colliding.
- Added dedicated final stylesheets for public pages, auth/onboarding and dashboards instead of creating alternative page designs.

## Verification added

- Full platform layout and Super Admin validation: **18/18**
- JavaScript syntax: **501/501**
- EJS templates: **124/124**
- Admin Flight nested render: **passed**
- Admin Local Mobility nested render: **passed**
- Existing Bus, Hotel, Flight-agent, Local Mobility, security, CSRF, ownership, dashboard and final regression gates remain passing.

---

# Classic Trip Final Platform Polish — 25 July 2026

This release preserves the approved Classic Trip UI and completes a platform-wide final polish for Bus, Accommodation, Flight Agents and Safe Local Mobility.

## Public experience

- Flight and Local Mobility controls now use the same compact rounded inputs, buttons, panels, chips and cards as the established public pages.
- Mobile layouts keep meaningful headings visible, reduce banner and control height, preserve clean spacing and prevent oversized service-specific controls.
- Marketplace listing cards keep **View** and **Book** together in one row; on narrow phones the price moves above the two actions without splitting them.
- Authentication and intelligent partner onboarding use tighter gaps, consistent rounded controls and responsive cards.
- The Partners marketing page now has a complete responsive directory, persuasive copy, verified partner details and aligned actions.
- Obsolete transport categories were removed from the registry, public UI, tests and source wording.

## Partner and dashboard intelligence

- One shared East Africa market configuration controls country name, ISO currency, calling code and timezone.
- Uganda uses UGX, Kenya uses KES, Rwanda uses RWF, Tanzania uses TZS, South Sudan uses SSP, DR Congo uses CDF, Burundi uses BIF and Somalia uses SOS.
- Partner signup and Super Admin partner creation derive operating currency automatically from country.
- Server-side company creation rejects unsupported countries and ignores mismatched client currency.
- Verified partners cannot change country through the normal profile workflow because country affects compliance, currency and settlement.
- Super Admin partner creation asks for the correct service-specific partner model: bus operator, accommodation provider, accredited flight agent, boda rider, car driver, fleet owner or mobility company.
- A safe legacy migration updates country currency only where there is no financial history; financially active mismatches are flagged for manual review.

## Search, SEO and AI discovery

- Flights and Local Mobility are first-class sitemap URLs.
- Every page provides canonical metadata, social metadata and a structured-data graph containing TravelAgency, WebSite/SearchAction and page/service schema.
- `robots.txt` supports conventional search engines and configured AI-search crawlers while protecting dashboards, accounts, checkout, tickets, private tracking, APIs and uploads.
- `/llms.txt` provides a concise public platform reference.
- `/llms-full.txt` provides a larger AI-readable public URL inventory.
- Training crawlers remain separately controlled by `SEO_ALLOW_AI_TRAINING`; AI search discovery does not automatically grant model-training access.

## Migration order for an existing database

1. `npm run migrate:commission-only:dry` then `npm run migrate:commission-only`
2. `npm run migrate:hotel-domain:dry` then `npm run migrate:hotel-domain`
3. `npm run migrate:flight-taxi:dry` then `npm run migrate:flight-taxi`
4. `npm run migrate:country-currency:dry` then review the output and run `npm run migrate:country-currency`
5. `npm run seed:travel-reference:dry` then `npm run seed:travel-reference`

Always back up MongoDB before applying migrations.

## Release verification

Dependency-free release validation passed for JavaScript, EJS, architecture, security, routes, CSRF, entity relationships, dashboards, Bus, Hotel, Flight Agents, Local Mobility, UI consistency and final regressions. Dependency-backed Jest and runtime module checks still require `npm ci` in a connected environment.
