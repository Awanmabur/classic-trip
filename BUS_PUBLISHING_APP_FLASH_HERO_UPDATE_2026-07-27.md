# Classic Trip update — 27 July 2026

## Bus publication and departure drivers

- Driver assignment is optional when creating, publishing, or activating a dated departure.
- Driver assignment is optional for recurring departure rules.
- A bus listing can publish when its route, vehicle, seat map, fare, compliance records, dated departure, and seat-segment inventory are ready, even when no driver is assigned.
- Any active company driver appears in the departure selector.
- Selecting an inactive company membership is rejected.
- Licence, safety, permissions, and account verification remain visible as operational/compliance information, but no longer keep a departure or listing in Draft.
- New departure forms default to Published and recurring rules default to Active, with driver assignment clearly marked optional.

## App launch flash

- The custom Classic Trip flash appears only inside the installed app/PWA standalone mode.
- It does not appear during normal website browsing.
- The flash contains only the transparent Classic Trip logo, name, and slogan.
- The visual was cleaned up with a transparent logo, balanced spacing, and a light-first background with dark-mode support.
- It appears once per app session.

## Homepage services

- Tours, car rentals, cargo, and Airbnb remain available through the hero/service experience and mobile drawer.
- The desktop top navigation has been simplified and no longer lists Tours, Car rentals, Cargo, or Airbnb as separate top-level links.
- All seven hero service tabs can be swiped with touch, dragged with a mouse, scrolled with a trackpad, or moved using a mouse wheel on desktop and mobile.
- Existing service routes, catalogues, checkout data, reservations, payment records, tickets, PDFs, inventory rules, partner dashboards, and promotion operations remain connected.

## Verification

- JavaScript syntax: 526/526
- EJS templates: 127/127
- Production bus workflow: 28/28
- Bus form contracts: 45/45
- Smart bus publishing: 19/19
- Optional driver assignment contract: 12/12
- Driver selector and accessibility: 23/23
- App-only branded flash: 7/7
- Seven-service completion: 38/38
- Marketing/mobile overflow: 27/27

## Development commands

```bash
cp .env.example .env
npm ci
npm run seed:superadmin
npm run check
npm run check:bus
npm run check:seven-services
npm run dev
```

## Production commands

```bash
npm ci --omit=dev
npm run db:indexes
npm run doctor
NODE_ENV=production npm run launch:check
npm run start:prod
```
