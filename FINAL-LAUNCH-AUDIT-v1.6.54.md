# Classic Trip v1.6.54 — Route Flow Correction

## Scope
This release corrects only the public bus-route presentation introduced in v1.6.53. It does not enlarge general card typography or redesign the approved cards.

## Corrections
- Only route chip text is enlarged.
- Removed the v1.6.53 bus-price font-size override.
- Bus cards use up to three independent horizontal route lanes.
- Home bus bars use up to two independent horizontal route lanes.
- Routes are balanced into the currently shortest lane so the rows are naturally staggered rather than aligned into rigid columns.
- Each new route starts immediately after the previous route in its lane.
- Route chips keep natural width; route names are not ellipsized or squeezed.
- The route viewport supports native horizontal left/right swipe and overflow scrolling.
- Switching between card and bar view re-renders the route lanes so the row count changes correctly from three to two.
- Semantic browser asset/cache version advanced to v1.6.54.

## Validation
- v1.6.54 route-flow checks: 10/10 passed.
- v1.6.53 marketplace/actions regression: 16/16 passed.
- Final release consistency: 11/11 passed.
- JavaScript syntax: 642/642 passed.
- EJS dependency-free syntax validation: 131/131 passed.

The artifact container timed out during a clean npm dependency installation, so npm-backed runtime tests were not claimed as executed here. Run `npm ci` normally on the deployment/local machine before launch.
