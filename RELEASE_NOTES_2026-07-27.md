# Classic Trip VIP, Dashboard CRUD and Single Launch Release

Release: 1.3.0  
Date: 27 July 2026

## VIP vehicle model

VIP is now a complete bus/vehicle class. Selecting VIP applies the VIP class to every sellable passenger seat in the vehicle's seat template, published seat-map version and future departure inventory. Accessible passenger positions keep their accessibility behaviour while inheriting the vehicle cabin class. Crew positions remain non-sellable. The active dashboard no longer exposes per-seat VIP toggles or per-seat VIP surcharges.

Existing databases can be reviewed and upgraded with:

```bash
npm run migrate:vip-vehicle-class:dry
npm run migrate:vip-vehicle-class
```

Back up MongoDB before applying the migration.

## Partner Admin CRUD and data fidelity

Partner Admin edit forms now load the canonical record selected in the table rather than a reduced summary or a different related user.

- Staff: name, email, phone, role, status, branch, permissions, service categories, listing/schedule scope, shift and notes.
- Drivers: account details, licence data, expiry, safety state, verification documents, branch, permissions, vehicle assignment and operational status.
- Branches and policies: create, view, edit and archive.
- Bus operations: listings, routes, route stops, vehicles, seat maps, departures, recurring rules, fares, stop-to-stop prices and add-ons.
- Stays and Airbnb: properties, room types, rate plans, room units and dated inventory.
- Tours, car rentals and cargo: service-specific listing creation, editing, publishing, archiving, bookings, promotions, support, reviews, settlement and reports.
- Invitations: resend and revoke.
- Promotions: create, edit, pause, resume and end.

Operational and financial records that must remain auditable use cancel, revoke, archive, approve/reject or status transitions instead of unsafe hard deletion.

## Single app launch

The second in-page launch overlay was removed from the server-rendered HTML, JavaScript and CSS. Installed PWAs now use only the browser/operating-system launch surface. The manifest uses transparent Classic Trip logo symbols and carries the app name and slogan. Exact native splash typography and line wrapping remain controlled by the installed-app platform.

## Verification

Run:

```bash
npm ci
npm run check
npm run check:vip-dashboard-crud
npm run check:dashboard-completeness
npm run check:dashboard-service-coverage
npm run check:staff-driver
npm run check:single-splash
npm run check:runtime
npm test
npm run verify
```
