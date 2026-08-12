# Classic Trip v1.6.58 — Marketplace Card Overlay Audit

## Scope
- Reduce the two badges drawn over marketplace images.
- Reduce/lift the bar availability or departure-count badge so it does not overlap route lanes.
- Remove text drawn over the listing preview hero image.
- Repair card-body clipping so two amenity lanes, the From/currency/amount line, Cheapest route fare hint, and View/Book actions remain fully visible.

## Root cause repaired
The equal-height card rules gave `.listingBody` `height:100%` while the thumbnail still consumed its own height. Since `.listing` uses `overflow:hidden`, lower body content could be clipped outside the card. v1.6.58 changes cards to a flex-column structure and makes the body flexible rather than independently 100% tall.

## Expected result
The image remains at the top, two smaller overlay badges sit on it, route/amenity lanes remain visible, and the complete price/action area stays inside the card. Bar inventory/departure badges are smaller and sit close to the top-right edge without covering routes. Preview hero images contain no text overlay.
