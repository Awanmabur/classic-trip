# Classic Trip v1.6.81 — Release Checklist

1. Preserve your local `.env` and `.git`, then extract v1.6.81 over the source tree.
2. Run `npm ci`.
3. Run `npm test`; target: **115/115 or higher, 0 failures**.
4. Run `npm audit --omit=dev --audit-level=moderate` and confirm zero launch-blocking vulnerabilities.
5. Run `npm run check:checkout-speed` and confirm **19/19**.
6. Run `npm run check:commercial-agreements` and confirm **21/21**.
7. Run `npm run check:pesapal-go-live` and confirm **9/9**.
8. Run `npm run check:go-live` and `npm run release:check`.
9. Confirm production has `PESAPAL_REQUEST_TIMEOUT_MS=12000` (or another deliberate value between 2500 and 20000ms).
10. Make one real low-value bus checkout. Confirm Render shows `Pesapal SubmitOrderRequest timing` only when provider latency is high, then the browser opens the returned Pesapal URL.
11. If Pesapal times out, confirm Classic Trip lands on the pending payment page and shows **Continue payment** rather than treating the booking as confirmed.
12. Verify the booking/payment callback still confirms amount + currency via GetTransactionStatus before ticket issuance.
13. Rotate the MongoDB credential previously detected in Git history, update Render/local env, and purge the old URI from Git history before final public launch.
