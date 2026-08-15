# Classic Trip v1.6.86 — Release Checklist

1. Preserve your local `.env` and `.git`, then extract v1.6.86 over the source tree.
2. Run `npm ci`.
3. Run `npm test`; target: **115/115 or higher, 0 failures**.
4. Run `npm audit --omit=dev --audit-level=moderate` and confirm zero launch-blocking vulnerabilities.
5. Run `npm run check:fast-runtime-ui` and confirm the company hot-path contracts pass.
6. Run `npm run check:checkout-speed` and confirm the bus availability/index contracts pass.
7. Run `npm run check:public-layout-content` to preserve the amenity and notification fixes.
8. Run `npm run check:commercial-agreements`.
9. Run `npm run check:pesapal-go-live`.
10. Run `npm run check:go-live` and `npm run release:check`.
11. Confirm Render pre-deploy completes `npm run db:indexes`; this creates the new bus segment availability index before traffic is switched.
12. After deploy, open Company Overview, Setup Guide, Manifests, Archive and Revenue once and compare the new `Slow request` timings with the 15 August baseline.
13. Make one low-value bus checkout and compare `availabilityMs`; the seat transaction must remain authoritative and successful.
14. Rotate and purge the historical MongoDB credential from Git history if that separate repository-security action is still outstanding.
