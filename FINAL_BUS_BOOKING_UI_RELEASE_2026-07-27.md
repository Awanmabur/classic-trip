# Classic Trip — Final bus booking and UI release

Date: 27 July 2026

## Completed corrections

### Departure activation and ownership

- Departure activation now accepts older departure records whose `companyId` is missing or contains a stale legacy value.
- Ownership is repaired only after the linked bus listing, route, or vehicle proves that the departure belongs to the current company.
- Cross-company departure activation remains blocked.
- Related seat and segment-inventory records with missing company ownership are repaired in the same transaction.
- Driver assignment remains optional for departure and listing publication.
- Any driver with an active company membership may be selected; incomplete safety/licence verification remains visible as diagnostics but does not block departure publishing.

### Manual travel schedule selection

- Opening a bus listing no longer automatically selects the first departure.
- Customers must explicitly select the outbound travel date and time before seats are loaded.
- Return schedules are also never auto-selected.
- Checkout blocks submission until the required outbound and return schedules are selected.

### Board-at / drop-at pricing

- Boarding and drop-off selectors send the selected stop IDs to the canonical availability endpoint.
- Changing either stop reloads segment inventory and the server-calculated fare.
- The displayed fare and checkout hold use the selected route segment, not the full-route fallback price.

### Return tickets

- Reverse departures are matched using reversed origin/destination branch IDs, with route-name fallback for older records.
- The user must select a return departure after the outbound journey.
- The number of return seats must equal the number of outbound seats.
- Outbound and return schedule IDs, stop IDs, holds, and seats are passed separately into the canonical booking and payment flow.
- Each journey retains its own ticket and QR data.

### App launch screen

- The branded launch surface is server-rendered in the initial installed-app HTML instead of being created later as a second animated overlay.
- It displays the transparent logo, `Classic Trip`, and `Move, stay and fly with confidence.`
- Normal browser pages remove the launch surface immediately.
- Maskable launch icons were removed from the web manifest so the installed launch surface uses the transparent symbol.
- The launch surface remains session-scoped and supports light and dark mode.

> Android/iOS may always show a system-controlled native launch surface before web content. The native surface and the pre-rendered branded surface now use the same transparent logo/background treatment, eliminating the previous visible second splash animation.

### Marketplace UI

- Homepage View and Book buttons remain on one line.
- Bus and return-seat controls now have fixed square dimensions and `aspect-ratio: 1 / 1`.
- The homepage category aside explicitly includes Tours, Car rentals, Cargo, and Airbnb homes.
- Dynamic marketplace cards preserve service and stay-type metadata.

### Removed passenger fields

The following customer and dashboard booking fields were removed from active frontend, backend, and model flows:

- Date of birth
- Passenger luggage item count

They were removed from bus, stay, flight, taxi, promoter-assisted booking, normalized guest/passenger models, and migration paths. Vehicle cargo/luggage capacity and paid extra-luggage service add-ons remain operational because they are service inventory/pricing features rather than passenger-profile fields.

## Verification

- JavaScript syntax: **528/528**
- EJS templates: **127/127**
- Final departure/booking/UI contracts: **20/20**
- Branded single-splash contracts: **7/7**
- Mobile navigation/PWA: **18/18**
- PWA installation: **44/44**
- Bus production workflow: **28/28**
- Bus form contracts: **45/45**
- Smart bus publishing: **19/19**
- Add-ons, return tickets and seats: **30/30**
- Stop pricing/UI: **15/15**
- Seven-service completion: **38/38**
- Dashboard service coverage: **68/68**
- Dashboard completeness: **52/52**
- Flight/taxi end-to-end static validation: **110/110**
- Bus/hotel end-to-end: **57/57**
- Bus/hotel architecture: **95/95**
- Bus/hotel conclusion: **37/37**
- System completion: **158/158**
- Production finalization: **30/30**
- Production readiness: **76/76**
- UI consistency: **16/16**
- Reference UI: **178/178**
- Marketing/mobile overflow: **27/27**
- Final regression: **42/42**

The dependency-backed Jest suite was not run in this packaging environment because `node_modules` is intentionally excluded. Run `npm ci` followed by `npm test` locally or in CI.

## Development setup

```bash
cd classic-trip-final-bus-booking-ui-2026-07-27
cp .env.example .env
npm ci
npm run seed:superadmin
npm run check
npm run check:final-departure-booking-ui
npm run check:bus
npm run check:addons-return-seats
npm run check:stop-pricing-ui
npm test
npm run dev
```

## Production preparation

```bash
cd classic-trip-final-bus-booking-ui-2026-07-27
npm ci --omit=dev
npm run db:indexes
npm run doctor
NODE_ENV=production npm run launch:check
npm run start:prod
```
