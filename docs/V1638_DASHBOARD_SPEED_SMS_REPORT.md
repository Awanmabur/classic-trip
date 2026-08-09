# Classic Trip v1.6.38 — All-dashboard speed + SMS ticket delivery

## Dashboard performance

v1.6.38 applies the same principles that made Super Admin Monitoring fast to the rest of the dashboard system:

- exact page-scoped entity plans for Super Admin, Support, Finance, Operations and Content dashboards;
- compact independent overview plans for Employee and Driver roles;
- Employee/Driver pages no longer hydrate the broad employee dataset on every navigation;
- shared auxiliary shell data (especially notification badges) is reused across role pages with a short stale-while-revalidate cache;
- customer/promoter identity heads are reused instead of read from Atlas on every page;
- company/platform heads have a longer bounded cache;
- cold dashboard row limits are reduced without removing page-specific detail data;
- dashboard read concurrency is raised moderately for the 24-connection pool;
- page snapshots stay fresh for 3 minutes and may be served stale while a background refresh happens;
- sidebar navigation prefetches on hover/focus/touch and warms only two pages during browser idle time;
- dashboard prefetch traffic is excluded from visitor monitoring.

These changes apply to Super Admin, Support, Finance, Operations, Content, Company Admin, Employee, Driver, Customer and Promoter dashboards.

## Confirmed ticket SMS

A paid confirmed ticket now uses the available customer contacts automatically:

- in-app + push for signed-in users;
- email when an email exists;
- SMS when a phone exists;
- WhatsApp when a phone exists.

SMS is no longer treated as a paid communication add-on. The old SMS/WhatsApp starter add-on was removed from the bus add-on presets.

The SMS body is intentionally short and contains the secure Classic Trip ticket URL. Email/WhatsApp retain the fuller ticket + PDF message. Generic booking confirmation delivery is queued through the encrypted outbox so provider network calls do not hold the checkout response open.

## Production SMS configuration

Set:

```env
SMS_API_URL=https://your-sms-provider-endpoint
SMS_API_TOKEN=your-provider-token
SMS_FROM=Classic Trip
SMS_REQUEST_TIMEOUT_MS=8000
```

The SMS endpoint is expected to accept JSON shaped as:

```json
{
  "to": "+2567...",
  "from": "Classic Trip",
  "title": "Booking confirmed ...",
  "message": "Classic Trip ticket ... Open: https://www.classictrip.org/tickets/...",
  "meta": {}
}
```

If a provider uses a different API contract, place a small provider adapter at `SMS_API_URL` or update `src/services/notification/smsService.js` for that provider.
