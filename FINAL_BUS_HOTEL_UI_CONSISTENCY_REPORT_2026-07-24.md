# Classic Trip Final Bus + Hotel UI Consistency Report

Date: 2026-07-24

## Scope

This pass preserves the approved Classic Trip visual language and reorganizes existing bus/hotel features without creating duplicate modules or alternative dashboards.

## Hotel workspace corrections

- Replaced the crowded header containing five simultaneous creation buttons, repeated counts, and tabs with one ordered six-stage setup journey:
  1. Public hotel listing
  2. Property profile
  3. Room type
  4. Rate plan
  5. Physical room unit
  6. Dated room-night inventory
- Each stage shows its stored record count and opens the existing canonical creation modal.
- Added an explicit public-listing prerequisite that was previously described but not represented in the Properties/Rooms workspace.
- Separated daily operations from setup:
  - Arrivals today
  - In-house stays
  - Departures today
  - Housekeeping queue
  - Maintenance/blocked rooms
- Added record counts to the hotel tabs.
- Added one contextual heading and action inside each tab instead of showing every creation action at once.
- Changed the main hotel workspace to full width so tables and the room calendar are not compressed beside the visual room map.
- Kept the existing canonical table IDs, modal types, routes, filters, calendar, room map, housekeeping and add-on workflows.

## Dashboard consistency corrections

- The Classic Trip logo/brand at the top of every dashboard now links to `/` and is labeled “Back to marketplace.”
- Dashboard notices now have consistent space from their parent card edges.
- Empty table rows now use one complete rounded surface in dark and light modes.
- Empty rows show a useful first-action instruction rather than looking like an unstyled table cell.
- Asset versions were changed so browsers do not keep old dashboard or marketplace styles/scripts.

## Marketplace card consistency

- Created one canonical `listing-card.ejs` for bus and hotel marketplace results.
- Home bus listings, home hotels, Search, Services, Company profile and Promoter pages now use the same server-rendered card.
- Dynamic “More” rendering on the homepage uses matching markup and copy.
- Cards consistently show image, availability/sponsorship state, rating, service type, title, route/location, partner, description, backend price and View/Book actions.
- Removed the second hard-coded homepage bus-card implementation.
- Removed a duplicated “Become a partner” footer link.

## Architecture status

The existing canonical bus and hotel domain boundaries remain unchanged and passed their release gates. This UI pass did not introduce another property, room, inventory, listing, booking, payment, manifest or settlement implementation.

## Static verification

- JavaScript syntax: 421/421
- EJS templates: 118/118
- Production architecture: 5604/5604
- Bus workflow: 28/28
- Bus form contracts: 45/45
- Smart bus forms: 30/30
- Smart publishing: 19/19
- Driver assignment: 15/15
- Driver UI/accessibility: 26/26
- Driver materialization: 5/5
- Staff/driver workflow: 50/50
- Partner ownership: 19/19
- Partner registration: 9/9
- Commission-only model: 40/40
- Dashboard repository readiness: 8/8
- Add-ons/return/seat layouts: 30/30
- Stop pricing/UI: 15/15
- Bus + hotel end-to-end: 57/57
- Final bus/hotel architecture: 95/95
- Hotel operations: 27/27
- Final regression: 43/43
- Final UI consistency: 16/16
- CSRF, route security, dashboard scope and entity-relationship gates: passed

## Runtime checks

Run in a connected development/staging environment after installing dependencies:

```bash
npm ci
npm run verify
NODE_ENV=production npm run launch:check
```

Use the existing dry-run database migrations before applying them to an older database:

```bash
npm run migrate:commission-only:dry
npm run migrate:hotel-domain:dry
```
