# Classic Trip v1.6.59 — Price hierarchy and badge sizing

## Scope
Small presentation-only correction on top of v1.6.58.

- Keeps `From UGX 32,000` fully visible.
- Reduces only `From` and the currency code to 72% of the price line size.
- Reduces `Cheapest route fare` to a compact 9px/600-weight hint.
- Makes the numeric amount slightly bolder using font-weight 900.
- Increases the two image badges slightly from v1.6.58.
- Increases the availability/departure-count badge slightly.
- Leaves route flow, amenities flow, card clipping repair, preview image cleanup, actions, and dashboard behavior unchanged.

## Validation
- `check:v1659-price-badges`: 11/11.
- v1.6.58 clipping/visibility regression: passed after making its version assertion forward-compatible.
- v1.6.57 price/amenities regression: 12/12.
- release consistency: 11/11.
