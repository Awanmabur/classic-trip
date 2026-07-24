# Classic Trip — Final Commission-Only Partner Report

Date: 2026-07-24

## Final commercial scope

Partner subscriptions, packages, recurring charges, upgrade flows and plan checkout have been removed from the application. Bus and hotel partners now use one commercial model only: a percentage commission on completed bookings.

### Booking split

1. The partner signs up directly without buying a package or paying a registration charge.
2. The platform creates a pending company and freezes its commission contract.
3. Verification—not payment or plan status—controls whether the company can publish and operate live services.
4. Each confirmed booking stores the exact partner commission percentage used.
5. Classic Trip retains that percentage.
6. The partner receives the remaining percentage.
7. An eligible promoter reward is taken from Classic Trip's retained commission, not deducted again from the partner.
8. Refunds, settlement and payouts use the booking's immutable percentage snapshot.

The fresh-install default is 10% Classic Trip commission and 90% partner share. When a valid promoter referral exists, the promoter receives 30% of Classic Trip's commission. For a 100,000 booking at the default rate, the partner still receives 90,000; Classic Trip's 10,000 is split into 7,000 platform net and 3,000 promoter reward.

Super Admin may change the default percentage for future partners and may apply a documented company-specific override. Historical bookings are not recalculated.

## Partner access

- Any eligible bus operator or hotel/stay company may create a partner owner account directly.
- Registration number and tax number may be completed during verification when unavailable at the first signup step.
- New partners enter a restricted onboarding workspace immediately.
- Pending partners can complete profile, contacts, payout ownership, documents and bus/hotel setup drafts.
- Publishing, live bookings, operational payment actions and payouts remain blocked until verification.
- Company staff and drivers remain invitation-only and permission-scoped.
- There is no registration payment, trial, renewal, expiry, upgrade or downgrade state.

## Removed runtime features

- Partner subscription and subscription-order models.
- Billing controller, billing service and billing repository.
- Pricing-plan, billing-checkout, billing-success and company-billing pages.
- Plan selection during signup.
- Upgrade and renewal routes.
- Monthly and annual partner fees.
- Selected-plan and pending-upgrade fields.
- Subscription activation from payment webhooks.
- Pricing and company-billing compatibility aliases.
- Obsolete invitation commission-plan fields.

Hotel rate plans and bus fare plans remain. They are operational pricing/policy entities for rooms and journeys, not partner subscriptions.

## Database migration

Back up MongoDB before applying changes.

```bash
npm run migrate:commission-only:dry
npm run migrate:commission-only
```

The migration:

- derives the previous effective platform percentage;
- creates or normalizes one commission contract for every company;
- normalizes old partner agreements to `percentage_commission`;
- removes retired commercial fields from companies, settings, agreements and invitations;
- drops the retired `subscriptions` and `subscriptionorders` collections;
- keeps booking, payment, commission, refund, settlement and payout history;
- does not alter immutable booking percentage snapshots.

Then apply the existing hotel normalization migration when required:

```bash
npm run migrate:hotel-domain:dry
npm run migrate:hotel-domain
```

## Verification

All dependency-free release gates passed:

- JavaScript syntax: 420/420
- EJS templates: 118/118
- Commission-only model: 40/40
- Production architecture: 5604/5604
- Bus workflow: 28/28
- Bus form contracts: 45/45
- Smart bus forms: 30/30
- Smart publication: 19/19
- Driver assignment: 15/15
- Driver UI/accessibility: 26/26
- Driver materialization: 5/5
- Staff and driver workflow: 50/50
- Partner ownership: 19/19
- Partner registration identity: 9/9
- Multipart CSRF: 40/40
- Browser CSRF: 4/4
- Dashboard repository readiness: 8/8
- Add-ons, return travel and seat layout: 30/30
- Stop pricing and UI: 15/15
- Bus and hotel end-to-end: 57/57
- Final bus/hotel architecture: 95/95
- Final bus/hotel conclusion: 37/37
- Final hotel operations: 27/27
- Final regression: 43/43
- Route security, architecture/security, entity relationships, dashboard scope and static route smoke: passed
- Package and lockfile root dependency declarations: matched

Executable split checks proved:

- 100,000 without referral → partner 90,000; Classic Trip 10,000.
- 100,000 with referral → partner 90,000; Classic Trip net 7,000; promoter 3,000.
- 12.5% company override → partner 87,500; commission 12,500.

## Runtime release checks

This artifact intentionally contains no `node_modules`. Runtime module loading could not run here because Mongoose, PDFKit and the other package dependencies are not installed in the artifact environment. In a connected development or staging environment run:

```bash
npm ci
npm run verify
NODE_ENV=production npm run launch:check
```

Also execute MongoDB transaction/concurrency tests, provider sandbox callbacks, current dependency audit, live notification delivery, load testing and penetration testing before production deployment.

Generated at: 2026-07-24T12:19:44.215140+00:00
