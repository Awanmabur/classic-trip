# Classic Trip v1.6.80 — Release Checklist

1. Preserve your local `.env` and `.git`, then extract v1.6.80 over the source tree.
2. Run `npm ci`.
3. Run `npm test`; target: **115/115 tests passing**.
4. Run `npm audit --omit=dev --audit-level=moderate` and confirm zero launch-blocking vulnerabilities.
5. Run `npm run check:unit-regressions` and confirm **9/9**.
6. Run `npm run check:commercial-agreements` and confirm **21/21**.
7. Run `npm run check:checkout-speed`, `npm run check:go-live`, and `npm run release:check`.
8. In Super Admin → Payments & Commercial Agreements, enter the real partner terms before taking live payments.
9. Test Standard, VIP/Premium, referred, discounted, and Stay bookings; verify customer total, partner amount, promoter amount, Classic Trip amount, and settlement ledger.
10. Rotate the MongoDB credential previously detected in Git history, update Render/local env, and purge the old URI from Git history before final public launch.
