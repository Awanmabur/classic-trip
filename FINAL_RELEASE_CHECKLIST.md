# Classic Trip v1.6.65 Production Release Checklist

- [ ] `npm ci` completes successfully.
- [ ] `npm run check:production-cleanup` passes.
- [ ] `npm run check:runtime-network` passes.
- [ ] `npm run check:public-performance` passes.
- [ ] `npm run doctor:network` confirms usable MongoDB and Redis connectivity.
- [ ] `npm run check:index-reconciliation` passes.
- [ ] `npm run db:indexes -- --dry-run` shows only expected index changes.
- [ ] `npm run db:indexes` completes successfully against production Atlas.
- [ ] `npm run verify` passes.
- [ ] `npm run audit:production` reports no high/critical production vulnerabilities.
- [ ] Production `.env`/Render secrets are configured outside source control.
- [ ] Redis is connected for production sessions/cache/rate limits.
- [ ] MongoDB transaction support is available.
- [ ] Web process starts and listens on the assigned port.
- [ ] Worker process starts separately when enabled.
- [ ] Home, Search and a bus listing preview are smoke-tested after deployment.
- [ ] A real booking flow verifies live departure/seat inventory remains authoritative.
