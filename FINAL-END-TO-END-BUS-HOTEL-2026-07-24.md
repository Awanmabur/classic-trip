# Classic Trip — Bus, Hotel and Commission-Only Partner Implementation

## Commercial model

Classic Trip uses one partner commission percentage. Partner companies register directly, complete verification and then receive the complete bus or hotel feature set. No commercial package, renewal workflow or recurring partner charge is used.

For each paid booking:

1. The backend loads the company commission contract.
2. The booking stores an immutable commercial terms snapshot.
3. Classic Trip retains the contract percentage.
4. The partner receives the remainder.
5. A valid promoter reward is paid from Classic Trip's commission and is never deducted again from the partner.
6. Commission, wallet, refund, settlement and payout records keep the same booking reference.

The fresh-install default is 10% partner commission. A promoter receives 30% of Classic Trip's commission when an eligible referral exists. Super Admin may change the platform default for new partners and may set a partner-specific percentage. Existing bookings retain their original snapshot.

## Partner onboarding

- Any eligible bus or hotel partner can create a company-owner account.
- Signup creates the account, pending company, percentage contract and zero-balance company wallet.
- Pending partners can complete onboarding but cannot publish, process live operations or request payouts.
- Verification controls activation; no registration payment controls access.
- Staff and drivers remain invitation-only.

## Bus completion

The bus implementation remains canonical from listing, vehicle, versioned seat map, route and ordered stops through fare products, stop-to-stop fares, dated departures, segment inventory, holds, booking items, reservations, passengers, seat assignments, tickets, payment, manifest, scanning, cancellation, refund and settlement.

## Hotel completion

The hotel implementation remains canonical from public listing, property, room type, hotel rate plan, room unit and explicit room-night inventory through reservation, named guests, assignments, payment, voucher, arrival, check-in, in-house stay, checkout, housekeeping, no-show, cancellation, refund review and fulfillment-based settlement.

Hotel rate plans are operational accommodation pricing and cancellation rules. They are not partner commercial packages and remain required.

## Existing database migration

Back up MongoDB first.

```bash
npm run migrate:commission-only:dry
npm run migrate:commission-only
npm run migrate:hotel-domain:dry
npm run migrate:hotel-domain
```

The commission migration:

- derives one percentage from the previous effective split;
- creates or normalizes every company commission contract;
- removes retired billing fields from companies, agreements and invitations;
- removes retired commercial fields from platform settings;
- drops the old partner subscription collections;
- leaves booking and financial history intact.

## Release checks

```bash
npm run check:commission-only
npm run verify
NODE_ENV=production npm run launch:check
```

Dependency-backed runtime, MongoDB transaction, provider sandbox and security tests must be executed in a connected staging environment before production deployment.
