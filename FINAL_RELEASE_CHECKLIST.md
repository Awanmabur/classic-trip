# Classic Trip v1.6.82 — Release Checklist

1. Preserve your local `.env` and `.git`, then extract v1.6.82 over the source tree.
2. Run `npm ci`.
3. Run `npm test`; target: **115/115 or higher, 0 failures**.
4. Run `npm audit --omit=dev --audit-level=moderate` and confirm zero launch-blocking vulnerabilities.
5. Run `npm run check:checkout-speed` and confirm **24/24**.
6. Run `npm run check:public-layout-content` and confirm **21/21**.
7. Run `npm run check:commercial-agreements` and confirm **21/21**.
8. Run `npm run check:pesapal-go-live` and confirm **9/9**.
9. Run `npm run check:go-live` and `npm run release:check` after the Git-history credential issue is cleared.
10. Confirm production has `PESAPAL_REQUEST_TIMEOUT_MS=12000` (or another deliberate value between 2500 and 20000ms).
11. Make one real low-value bus checkout. After `outcome=redirect_received`, confirm the browser opens `/booking/payment/handoff/<bookingRef>` and the Pesapal methods appear inside the iframe.
12. Confirm **Open Pesapal payment** opens the same verified Pesapal checkout in the top window as a fallback.
13. If Pesapal does not return a checkout URL, confirm Classic Trip shows the retry-safe **Continue payment** state rather than treating the booking as confirmed.
14. Verify amount + currency are still confirmed through Pesapal GetTransactionStatus before ticket issuance.
15. Check Home bus cards in Cards view and confirm both amenity lanes remain above/in front of the price/actions footer.
16. Rotate the MongoDB credential previously detected in Git history, update Render/local env, and purge the old URI from Git history before final public launch.
