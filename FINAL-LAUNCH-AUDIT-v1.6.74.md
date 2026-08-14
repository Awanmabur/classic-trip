# Classic Trip v1.6.74 — Launch Security Final Audit

## Scope

This release hardens the production application against the 20 launch-security controls supplied by the platform owner, while preserving v1.6.72 Stay media, marketplace performance, Pesapal verification, Redis recovery, booking integrity, dashboards, and public UX.

## Implemented security controls

1. Secrets remain server-side and private env/key files are excluded from Git/release archives.
2. `check:secret-hygiene` scans the source tree and, when `.git` is present, Git tracked files/history for high-confidence secrets.
3. MongoDB credentials remain server-only; production Mongo transport must use SRV/TLS.
4. Application-layer tenant/row access is enforced through authenticated company/customer ownership checks. MongoDB is not exposed with a public client key and therefore does not use Supabase-style native RLS.
5. Sensitive stored identifiers/tokens use AES-256-GCM. New writes use `DATA_ENCRYPTION_KEY`; legacy v1 ciphertext remains readable with the unchanged `SESSION_SECRET`.
6. Protected APIs/actions use server-side session/account-state authorization.
7. Company/customer records are scoped to owners/authorized roles.
8. Public/API writes reject protected pricing/payment/ownership field tampering; payment amount/currency remain server/provider authoritative.
9. Session cookies are HttpOnly, production-Secure, SameSite=Lax, Priority=High; auth flows regenerate sessions.
10. Passwords use bcrypt cost 12 with timing-protection for unknown accounts.
11. Login has 10/15-minute throttling, 100/day IP throttling, and account lockout after repeated failures.
12. Public auth/onboarding/reset/invitation forms use signed short-lived bot proof + honeypot, in addition to rate limits.
13. Mongoose `strictQuery` plus app-wide recursive `$`/dot/NUL key rejection defend query/operator injection. Global `sanitizeFilter` is intentionally disabled because it corrupts Classic Trip’s server-built `$in`/`$ne` filters; untrusted HTTP operator keys are rejected before route logic runs.
14. Body sizes are bounded and express-validator plus multipart post-parse key checks validate untrusted input.
15. EJS user content remains escaped; raw script JSON is emitted only via `toScriptJson`, which escapes script-breaking characters.
16. Uploads use allow-listed MIME/extensions, bounded multipart limits, and binary signature validation.
17. API JSON is recursively redacted for secret/encrypted/token fields and authenticated API responses are no-store/private.
18. Helmet/CSP, HSTS, Referrer-Policy and Permissions-Policy are enabled.
19. Production HTTP redirects to HTTPS and production Mongo connections require encrypted transport.
20. `release:check` includes a production dependency audit at moderate-or-higher severity.

## Added launch gates

- `npm run check:secret-hygiene`
- `npm run check:security-launch-20`
- Both are included in `npm run check:go-live` and `npm run release:check`.

## Required production setting

`DATA_ENCRYPTION_KEY` must be a distinct random secret of at least 32 characters. Render Blueprint generates it for the web service and shares the same value with the worker. Manual deployments must set it before production boot.

## Compatibility

No database deletion or reseed is required. Values encrypted before v1.6.74 remain readable as long as the existing `SESSION_SECRET` is preserved. New sensitive-field writes use v2 encryption under `DATA_ENCRYPTION_KEY`.

## Final security hardening

- 20/20 supplied launch-security controls are implemented and automated.
- 5/5 secret-hygiene checks pass on the clean source tree.
- 8/8 runtime log-redaction cases pass.
- 16/16 Pesapal provider-security checks and 8/8 Pesapal go-live contracts pass.
- Dedicated `DATA_ENCRYPTION_KEY` separates stored-data encryption from session signing; legacy ciphertext remains readable for a safe rollout.
- Public protected-field tampering, dangerous Mongo-style keys, unsafe raw EJS output, and secret-bearing API/log output are explicitly gated.


## v1.6.74 go-live hotfixes

- Dandy Hotel Juba uses the bundled verified real JPEG as the canonical public image for seed-owned Dandy/Daddy legacy records; partner-uploaded media still wins.
- Stay availability keeps server-built Mongo operators functional, fixing the RoomUnit `status` `$in` CastError while retaining app-wide HTTP operator-key rejection.
- `doctor:pesapal` performs a non-charge credential/control-plane check on localhost and remains strict when run with production HTTPS configuration.
- Secret hygiene ignores a git-ignored local `.env` as a release artifact, but Git-history credentials remain a hard failure until purged and rotated.
