# Classic Trip v1.6.75 — Render Cold-Home Warmup Final

v1.6.75 fixes the production cold-start Home spike observed on Render (`GET /` around 2.4s immediately after a deploy). The web port still opens first, but production `/ready` now remains in a warming state until the lightweight anonymous Home/Search cache is prepared. Startup warmup reads the shared Redis discovery snapshot first and only falls back to the bounded lightweight Atlas discovery query when Redis is cold. A 10-second readiness deadline prevents a temporary cache/Atlas problem from trapping the deployment forever.

The discovery builder also reuses the already-loaded in-process platform configuration instead of rereading that setting from MongoDB during a cold Home build. Booking, payment, seat and room-night inventory are not preloaded and remain authoritative live reads.

Expected production startup sequence:

```text
Redis connected
MongoDB connected
Classic Trip listening
Public discovery cache warmed before traffic readiness
/ready -> 200
```

# Classic Trip v1.6.75 — Go-Live Runtime Hotfix Final

v1.6.75 preserves the v1.6.73 security controls and fixes four issues exposed by the final local launch run: Dandy Hotel now uses its bundled verified real JPEG as the canonical runtime image; Mongoose internal `$in`/`$ne` filters no longer get corrupted by global `sanitizeFilter` while HTTP `$`/`.` keys remain blocked app-wide; the Pesapal doctor performs a safe credential/control-plane check on localhost and remains strict on production HTTPS; and secret hygiene allows a git-ignored local `.env` while continuing to hard-fail real Git-history secrets until they are purged and credentials rotated.

# Classic Trip v1.6.75 — Launch Security Final

v1.6.75 implements and verifies the 20 launch-security controls supplied for final production review.

Highlights:
- dedicated AES-256-GCM `DATA_ENCRYPTION_KEY` for new sensitive-field encryption with legacy ciphertext compatibility;
- Git/source secret-hygiene scanning;
- server-only Mongo credentials with production TLS enforcement;
- strengthened tenant/record scoping and public protected-field tampering rejection;
- secure cookies/session regeneration, bcrypt cost 12, login short-window + daily IP rate limiting and account lockout;
- signed bot proof + honeypot on public authentication/onboarding/reset/invitation forms;
- recursive dangerous Mongo key rejection at the HTTP boundary plus strictQuery;
- bounded input/upload validation plus file signature checks;
- hardened script JSON escaping and API response secret redaction;
- CSP/HSTS/referrer/permissions headers and HTTPS enforcement;
- production npm audit included in the release gate.

No dependency versions, database schema, marketplace layout, or Pesapal transaction logic were changed. The Dandy seed/runtime image handling and local Pesapal doctor behavior were corrected in v1.6.75.

Security finalization adds centralized production log redaction for secret-like metadata, bearer values, cookies, credential URLs, and password/token/key assignments. A new `check:log-redaction` runtime contract is included in both `check:go-live` and the full `verify` chain. See `SECURITY-20-CONTROLS.md` for the supplied 20-control implementation matrix.

