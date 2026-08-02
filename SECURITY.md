# Security Policy

## Supported release

Classic Trip 1.4.1 is the supported release in this package.

## Reporting a vulnerability

Do not disclose a suspected vulnerability publicly. Send the affected route or component, reproduction steps, impact, and relevant request IDs/log timestamps to the project owner through the private operational contact configured for Classic Trip.

Do not include real passwords, access tokens, payment credentials, customer identity documents, or full production database records in a report.

## Production requirements

- Use HTTPS only and keep proxy forwarding correctly configured.
- Use strong unique secrets and rotate exposed credentials immediately.
- Run MongoDB with replica-set/Atlas transaction support.
- Use Redis for sessions, login counters, rate limits, and shared runtime coordination.
- Keep Cloudinary, payment, email, WhatsApp, and push credentials outside source control.
- Run `npm run release:check` before deployment and after dependency changes.
- Send application audit/security logs to an externally managed SIEM or log platform with retention and alerting.
- Place the public service behind provider-level DDoS protection, WAF/rate controls, and network monitoring. Application code cannot by itself prove that external IDS/IPS/WAF/SIEM controls are enabled.
