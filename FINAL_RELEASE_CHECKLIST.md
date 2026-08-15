# Classic Trip v1.6.85 — Release Checklist

1. Preserve your local `.env` and `.git`, then extract v1.6.85 over the source tree.
2. Run `npm ci`.
3. Run `npm test`; target: **115/115 or higher, 0 failures**.
4. Run `npm audit --omit=dev --audit-level=moderate` and confirm zero launch-blocking vulnerabilities.
5. Run `npm run check:unit-regressions` and confirm **9/9**.
6. Run `npm run check:checkout-speed` and confirm **28/28**.
7. Run `npm run check:public-layout-content` and confirm **22/22**.
8. Run `npm run check:commercial-agreements` and confirm **21/21**.
9. Run `npm run check:pesapal-go-live` and confirm **9/9**.
10. Check Home bus listings in both **Cards and Bars**: both amenity lanes must be fully visible; lane two must not be clipped; there must be **no new gap below amenities**.
11. Switch to **Light mode**, open the notification popup and Notifications page, and confirm notification titles/body/status text are readable against light cards.
12. Complete one real low-value bus checkout and confirm no validation message mentions `paymentInitiationStatus` or `initiating`.
13. Confirm the browser opens `/booking/payment/handoff/<bookingRef>` and Pesapal payment methods appear.
14. Confirm **Open Pesapal payment** opens the same verified Pesapal checkout in the top window as a fallback.
15. Verify amount + currency are still confirmed through Pesapal GetTransactionStatus before ticket issuance.
16. Confirm production logs show the first `Payment provider control plane warmed` at info, without another identical info line every four minutes under the normal production log level.
17. Open `/tickets?bookingRef=<ref>` after checkout and confirm the warm marketplace lookup path is used.
18. Run `npm run check:go-live` and `npm run release:check` after the Git-history credential issue is cleared.
19. Rotate the MongoDB credential previously detected in Git history, update Render/local env, and purge the old URI from Git history before final public launch.
