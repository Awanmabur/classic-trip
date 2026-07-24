# Classic Trip final stop-pricing and UI completion

## Homepage bus card

- Restored the main-page bus listing card composition from the uploaded reference project.
- Bus cards now use the compact title, route/operator metadata, two-line description, price and actions layout.
- The server-rendered card and JavaScript-rendered card use the same markup, so the design does not change after page hydration or “More” actions.
- The displayed amount is the lowest active stop-to-stop fare and is labelled as a starting fare; the final amount is calculated after boarding and drop-off selection.

## Boarding and drop-off pricing

- The traveler chooses a boarding stop and a later drop-off stop.
- The availability endpoint recalculates the price, seat availability and required route segments for that exact journey.
- Exact stop-pair pricing has first priority.
- When an exact stop-pair fare is absent, the server can combine connected configured fare bands. For example, Kampala to Gulu plus Gulu to Adjumani can price Kampala to Adjumani without requiring a price for every minor stop.
- The server still validates that the physical route segments are continuous and rejects incomplete pricing instead of trusting a browser total.
- Destination choices at or before the boarding stop are disabled, and boarding choices at or after the destination are disabled.
- Checkout, holds, reservations, ticket legs and payment totals continue to carry the selected origin and destination IDs.

## Preview page

- Removed the separate “Selected journey fare” section.
- Added a simple explanation under the stop selectors that the fare changes according to the selected journey.
- The booking summary continues to update its base price, fees, add-ons and total after every stop or seat change.

## Partner add-ons

- Starter types remain available for common extras, but they only fill name, description, category and charging method.
- No starter type selects, copies or defaults a price.
- The partner admin must enter the add-on unit price in the listing currency.
- The backend also requires the submitted admin price, so a missing price cannot silently fall back to a template amount.

## Input and payment-page presentation

- Removed colored focus/background effects from clicked form inputs and dashboard controls.
- Added top spacing to the Ticket / passenger information and Ticket / seats preview containers.
- Standardized passenger text inputs and selects to the same 44px height, including sex and emergency-contact fields.

## Verification

- EJS templates: 121/121
- Production architecture: 5651/5651
- Bus workflow: 28/28
- Bus forms: 45/45
- Smart bus forms: 30/30
- Add-on/return/seat checks: 30/30
- Final regression checks: 42/42
- New stop-pricing/UI checks: 15/15
- Smart publication, driver workflows, partner ownership, security, CSRF, entity relationships and dashboard checks all passed.
