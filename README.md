# Classic Trip v1.6.80 — Flexible Commercial Agreements

Production East Africa travel marketplace for buses, Stays, flights, local mobility, tours, car rentals, and cargo.

v1.6.80 adds a Super Admin-controlled commercial-agreement engine. Classic Trip can earn a percentage or fixed amount per agreed unit, with partner/listing/fare-plan/room-type overrides. Promoter rewards and customer discounts are funded only from Classic Trip's share. Every booking freezes the commercial terms and split used for settlement.

## Launch validation
```bash
npm ci
npm test
npm audit --omit=dev --audit-level=moderate
npm run check:commercial-agreements
npm run check:checkout-speed
npm run check:go-live
npm run release:check
```

## Important security action
If `check:secret-hygiene` reports a MongoDB URI in Git history, rotate the affected credential and purge the secret from Git history. Do not suppress the gate.
