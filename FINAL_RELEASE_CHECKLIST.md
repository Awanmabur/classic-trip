# Classic Trip v1.6.84 — Release Checklist

1. Preserve your local `.env` and `.git`, then extract v1.6.84 over the source tree.
2. Run `npm ci`.
3. Run `npm test`; target: **115/115 or higher, 0 failures**.
4. Run `npm audit --omit=dev --audit-level=moderate` and confirm zero launch-blocking vulnerabilities.
5. Run `npm run check:unit-regressions` and confirm **9/9**.
6. Run `npm run check:checkout-speed` and confirm **27/27**.
7. Run `npm run check:public-layout-content` and confirm **21/21**.
8. Run `npm run check:commercial-agreements` and confirm **21/21**.
9. Run `npm run check:pesapal-go-live` and confirm **9/9**.
10. Run `npm run check:go-live` and `npm run release:check` after the Git-history credential issue is cleared.
11. Confirm production has `PESAPAL_REQUEST_TIMEOUT_MS=12000` (or another deliberate value between 2500 and 20000ms).
12. Open a Bus listing from Home and select a route/departure. Confirm the first availability call no longer has to rebuild the listing/company/publication context from Atlas; live seat inventory must still be authoritative.
13. Check Home bus listings in both **Cards and Bars**. Both amenity lanes must be visible **in front of** the lower price/actions area, and there must be **no new gap below amenities**.
14. Complete one real low-value bus checkout. Confirm no validation message mentions `paymentInitiationStatus` or `initiating`.
15. After Pesapal initiation, confirm the browser opens `/booking/payment/handoff/<bookingRef>` and the Pesapal methods appear inside the iframe.
16. Confirm **Open Pesapal payment** opens the same verified Pesapal checkout in the top window as a fallback.
17. If Pesapal does not return a checkout URL, confirm Classic Trip shows the retry-safe **Continue payment** state rather than treating the booking as confirmed.
18. Verify amount + currency are still confirmed through Pesapal GetTransactionStatus before ticket issuance.
19. Open `/tickets?bookingRef=<ref>` after checkout and confirm it loads from the warm marketplace path instead of triggering a multi-second full-catalog read.
20. Rotate the MongoDB credential previously detected in Git history, update Render/local env, and purge the old URI from Git history before final public launch.
