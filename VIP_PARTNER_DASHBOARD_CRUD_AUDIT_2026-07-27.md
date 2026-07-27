# Classic Trip VIP and Dashboard CRUD Audit

Release: 1.3.0  
Date: 27 July 2026

## VIP is a complete vehicle class

VIP is selected once for the vehicle. The class is copied into the vehicle, editable seat-map template, immutable published seat-map version, compatibility seat projection and future departure inventory.

- Every sellable passenger seat in a VIP vehicle is VIP.
- Every sellable passenger seat in a Standard vehicle is Standard.
- Accessible passenger positions keep their accessibility behaviour and inherit the vehicle class.
- Crew positions remain non-sellable.
- Per-seat VIP toggles and per-seat VIP price differences were removed from active dashboard forms.
- Changing a vehicle between Standard and VIP publishes a replacement seat-map version so existing departures keep their historical seat snapshot.
- `scripts/migrate-vip-vehicle-class.js` normalises legacy vehicle and seat-map data and removes old per-seat VIP deltas.

## Partner Admin canonical editing

The Edit action now receives the exact canonical row selected instead of a reduced display summary or an unrelated linked account.

### Staff

Partner Admin can create/invite, view, edit, activate, suspend, revoke and manage:

- full name, email and phone;
- role, status, branch and shift;
- permissions and service categories;
- listing and schedule scopes;
- operational notes.

Invitation records support resend and revoke.

### Drivers

Partner Admin can create/invite, view, edit, activate, suspend/revoke and assign:

- full account identity and contact details;
- licence number, class and expiry;
- verification documents and references;
- safety state and operational status;
- branch, permissions and service scope;
- assigned vehicle/fleet.

Driver Edit now opens the driver employee record and linked driver account, not a generic staff summary.

### Company setup

Branches and policies support create, view, edit and archive with company ownership checks. Company profile/settings, support contacts, payout identity and verification state remain editable through their dedicated operations.

### Bus operations

Real lifecycle actions are wired for listings, routes, route stops, vehicles, whole-vehicle seat maps, dated departures, recurring rules, fare products, stop-to-stop fares and add-ons. Actions include create, view, edit, publish/activate, pause/resume, duplicate/materialise where applicable, and archive/cancel.

### Stays and Airbnb-style inventory

Properties, room types, rate plans, room units and dated room nights support create, view, edit and archive/status operations. Room-night edits persist price, arrival/departure closures, stay limits and housekeeping state.

### Tours, car rentals and cargo

Partner dashboards expose dedicated sidebars and real service-specific listing fields, bookings, promotions, support, reviews, finance, settlement and reports.

### Promotions and service operations

Promotions support create, edit, pause, resume and end. Reviews support replies. Support cases support real responses. Payouts, refunds, payments, bookings and other auditable records use explicit state transitions instead of destructive deletion.

## Single installed-app launch

The second in-page splash was removed from EJS, JavaScript and CSS. Installed PWAs now use only the browser/operating-system launch surface declared by `site.webmanifest`.

- Transparent Classic Trip logo icons are used.
- The manifest carries `Classic Trip` and `Move, stay and fly with confidence.`
- The normal website renders no splash overlay.
- Exact native text layout remains controlled by Android, iOS and the installed browser.

## Verification results

- JavaScript syntax: **530/530**
- EJS templates: **127/127**
- VIP and Partner Admin CRUD: **170/170**
- Dashboard completeness: **52/52**
- Dashboard service coverage: **68/68**
- Staff and driver workflow: **50/50**
- Native single splash: **7/7**
- Seven-service completion: **38/38**
- Final departure/booking UI: **20/20**
- Production architecture: **6632/6632**
- Production readiness: **76/76**
- System completion: **158/158**
- Final regression: **42/42**
- Bus workflow: **28/28**
- Bus form contracts: **45/45**
- Smart bus forms: **30/30**
- Smart publishing: **19/19**

`npm ci` could not complete in the build container because its internal npm package gateway returned repeated HTTP 503 responses. Therefore the dependency-backed runtime gate and Jest suite must be run locally or in CI after package installation.

## Existing database upgrade

Back up MongoDB first.

```bash
npm ci
npm run migrate:vip-vehicle-class:dry
npm run migrate:vip-vehicle-class
npm run check:vip-dashboard-crud
npm run check:runtime
npm test
npm run verify
npm run dev
```
