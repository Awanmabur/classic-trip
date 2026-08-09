# Classic Trip v1.6.34 — Rolling conflict scan fix

## Root cause
With a one-date worker batch, v1.6.33 preflighted only the first 10 missing dates. If all ten overlapped another departure, the worker created nothing and never inspected dates 11–30 during that pass. Repeated cron/startup scans could therefore print the same warning while later free dates remained undiscovered.

## Fix
- Scan the complete missing 30-day window until the next free date is found.
- Still create only the configured one-date batch at a time to protect MongoDB performance.
- Preload the vehicle's relevant schedules once instead of making one overlap query per calendar date.
- Include conflicting schedule ID, recurring rule ID, route ID and times in warnings.
- Report clearly when the entire missing window is blocked for that vehicle.
- Suppress identical repeated conflict warnings for 30 minutes.
- Never bypass a genuine vehicle overlap.

## Diagnostic command
After `npm ci`, run `npm run rolling:diagnose -- company-2 schedule-rule-11 schedule-rule-14` to print the exact schedule/rule occupying the vehicle on each conflicting date.
