# Classic Trip v1.6.33 — Final stability release

## Runtime issues fixed
- Bus From/To/date search now matches every live route in a listing instead of only the listing's first route.
- General marketplace search dynamically switches to valid database-backed bus From/To pairs when Bus is selected.
- Company and role dashboard notification pages open through real routes and render the live notification API.
- Content Admin is included in the notification API authorization set.
- Rolling departure vehicle conflicts are date-specific: a conflicted date is deferred while later free dates remain eligible.
- Initial rolling materialization cannot batch across a date that preflight intentionally skipped because of a vehicle overlap.
- New/edited/resumed active recurring rules reject obvious same-vehicle recurring overlaps before they are saved.

## Important operational behavior
Vehicle permit, inspection, insurance, and genuine overlapping-departure failures remain safety blockers for the affected departure. Classic Trip does not publish an unsafe or double-booked vehicle. Fix the vehicle documents or assign a different vehicle/time for those affected rules.
