# Classic Trip — 20 Launch Security Controls (v1.6.74)

This matrix maps the 20 supplied launch-security checks to the implementation and automated gate that enforces them.

| # | Control | Classic Trip implementation |
|---|---|---|
| 1 | Hide API keys | Secrets live in server environment variables only; browser assets/templates are scanned for secret variable exposure; centralized logger redacts secret-like fields, bearer tokens, cookies and credential URLs. |
| 2 | Purge Git secrets | `check:secret-hygiene` scans the release tree, tracked files and Git history (when `.git` is present) for env/key files and high-confidence secret values. |
| 3 | Server-only DB credentials | MongoDB connection is server-side through `MONGO_URI`; no DB credential is exposed to public assets. |
| 4 | Row/tenant access | Company and API access middleware enforces company/user scope before data access. |
| 5 | Encrypt sensitive data at rest | AES-256-GCM with dedicated `DATA_ENCRYPTION_KEY`; sensitive identity fields are encrypted and plaintext migration tooling is provided. Legacy ciphertext remains readable for safe rollout. |
| 6 | Server-side authentication | Sessions/API auth are verified server-side and login regenerates sessions. |
| 7 | Owner/scope record access | Booking/ticket/company resources enforce ownership or authorized company scope. |
| 8 | Block field tampering | Public booking/payment writes reject protected fields such as payment status, amount/currency, commission and ownership controls; totals are calculated server-side. |
| 9 | Secure cookies | Session cookies are HttpOnly, Secure in production, SameSite=Lax and high priority; anonymous CSRF uses a signed double-submit token. |
| 10 | Password hashing | bcrypt with cost 12 plus constant-work dummy verification for unknown identities. |
| 11 | Login throttling/lockout | Short-window and daily IP rate limits plus account lockout after repeated failures. |
| 12 | Bot protection | Signed human-form proof and honeypot on sensitive anonymous auth flows, in addition to rate limiting. |
| 13 | Query/operator injection | Mongoose strict/sanitized filters plus request rejection for dangerous object keys, `$` operators and dotted keys. |
| 14 | Validate untrusted input | Bounded JSON/urlencoded/multipart bodies, request validators and post-multipart dangerous-key checks. |
| 15 | XSS/template escaping | Normal EJS escaping is enforced; raw EJS output is statically audited; script JSON escapes `<`, `>`, `&`, U+2028 and U+2029. |
| 16 | Upload security | MIME/extension allow-list, bounded size/parts/fields, in-memory validation and file-signature checks before persistence. |
| 17 | API response minimization | Sensitive response keys are scrubbed/redacted and private API responses use no-store/private caching. |
| 18 | Modern browser headers | Helmet CSP/HSTS plus Permissions-Policy and strict referrer policy. |
| 19 | Encrypted transport | Production HTTP redirects to HTTPS; production APP_URL/callbacks require HTTPS; MongoDB production TLS/SRV requirements are enforced. |
| 20 | Dependency scanning | `release:check` runs `npm audit --omit=dev`; lockfile integrity is also validated. |

Additional defense in depth: structured logs are recursively sanitized before output. Secret-looking metadata keys are redacted, as are Bearer values, Cookie/Set-Cookie headers, credential-bearing URLs, and common password/token/key assignments embedded in free-form messages.

Automated verification:

```bash
npm run check:security-launch-20
npm run check:secret-hygiene
npm run check:log-redaction
npm run check:pesapal-security
npm run check:pesapal-go-live
npm run check:go-live
npm run release:check
```
