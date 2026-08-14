# Classic Trip Security

Classic Trip uses server-side authentication and authorization, tenant/company scoping, CSRF protection, secure production cookies, session regeneration, bcrypt password hashing, layered rate limiting/account lockout, signed bot-proof/honeypot controls, strict input validation, Mongo operator-key rejection, file-type/signature validation, API response redaction, Helmet/CSP/HSTS security headers, HTTPS/TLS enforcement, payment-provider verification, and production dependency auditing.

Sensitive stored identifiers and operational tokens are encrypted with AES-256-GCM. v1.6.74 introduces `DATA_ENCRYPTION_KEY` as a dedicated production encryption secret; it must be distinct from `SESSION_SECRET`. Legacy ciphertext remains readable under the preserved session secret for backward compatibility.

Run before launch:

```bash
npm run check:secret-hygiene
npm run check:security-launch-20
npm run check:go-live
npm run release:check
```

If `check:secret-hygiene` finds a secret anywhere in Git history, removing the current file is not enough: purge the historical object and rotate the affected credential before deployment.
## Production log redaction

All structured log metadata is sanitized recursively. Secret-like keys, authorization values, cookies, credential-bearing URLs, and common password/token/key assignments are replaced with `[REDACTED]` before output. Run `npm run check:log-redaction` to validate representative leak cases.

See `SECURITY-20-CONTROLS.md` for the complete launch-security mapping.

