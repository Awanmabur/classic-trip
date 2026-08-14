# Classic Trip v1.6.74 — Final Release Checklist

1. Preserve the existing production `SESSION_SECRET`; changing it would invalidate sessions and prevent legacy encrypted v1 fields from being decrypted.
2. Set a new, distinct `DATA_ENCRYPTION_KEY` of at least 32 random characters (Render Blueprint can generate it automatically).
3. Keep `.env`, private keys, seed credentials and service-account files out of Git and deployment archives.
4. Run `npm ci` and confirm `npm audit --omit=dev --audit-level=moderate` passes.
5. Run `npm run check:secret-hygiene` in the real Git working copy. If it detects a historical secret, purge it from Git history and rotate that credential before launch.
6. Run `npm run check:security-launch-20` and require 20/20.
7. Run `npm run check:go-live` and `npm run release:check`.
8. Run `npm run doctor:network`. Local `npm run doctor:pesapal` checks credentials/control-plane only; run `npm run doctor:pesapal -- --production` on the deployed HTTPS environment for final callback/IPN certification.
9. Deploy, then complete one controlled low-value Pesapal payment and verify callback/IPN/GetTransactionStatus, idempotent paid state, receipt/ticket, and no duplicate booking/payment mutation.
10. Confirm production logs show no secret values, stack traces to customers, repeated auth failures, Redis permanent disconnects, or Mongo TLS/configuration errors.

## Security launch gate

Run:

```bash
npm run check:security-launch-20
npm run check:secret-hygiene
npm run check:log-redaction
npm run check:pesapal-security
npm run check:pesapal-go-live
```

Before production, generate a distinct `DATA_ENCRYPTION_KEY` (32+ random characters) and never reuse `SESSION_SECRET`, Pesapal credentials, or Cloudinary credentials for it.

