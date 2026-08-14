# Classic Trip v1.6.81 — Fast Bus Checkout + Pesapal Handoff

Production East Africa travel marketplace for buses, Stays, flights, local mobility, tours, car rentals, and cargo.

v1.6.81 preserves the flexible Super Admin commercial-agreement engine and fixes the production bus checkout/payment bottleneck. Secure holds are shorter, the passenger form reuses the server-side booking draft instead of rereading Atlas, Mongo booking persistence overlaps Pesapal order creation, and Pesapal timeouts no longer leave travelers without a clear payment continuation path.

## Launch validation
```bash
npm ci
npm test
npm audit --omit=dev --audit-level=moderate
npm run check:checkout-speed
npm run check:commercial-agreements
npm run check:pesapal-go-live
npm run check:go-live
npm run release:check
```

## Pesapal production setting
```env
PESAPAL_REQUEST_TIMEOUT_MS=12000
```
Render is already configured with this default in `render.yaml`. If SubmitOrderRequest remains slow, the runtime now logs `Pesapal SubmitOrderRequest timing` with the provider-only duration.

## Important security action
If `check:secret-hygiene` reports a MongoDB URI in Git history, rotate the affected credential and purge the secret from Git history. Do not suppress the gate.
