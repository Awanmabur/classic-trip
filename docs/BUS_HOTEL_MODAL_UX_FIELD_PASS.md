# Bus/Hotel Modal UX and Field Completion Pass

This pass improves the shared admin dashboard modal behavior without changing the dashboard design.

## What changed

- Increased the shared dashboard modal width from 850px to 1120px so edit/view forms have enough room.
- Reworked view modals so they show curated, important fields only instead of dumping raw backend objects.
- Added bottom action buttons inside view modals: Export PDF, Copy reference, Edit, Delete/archive where permitted, and Close.
- Made table rows clickable. Clicking a data row opens the same view modal as the eye icon. Clicking buttons/forms inside the row does not accidentally open the row modal.
- Kept delete as a soft archive POST action with CSRF.
- Improved company form fields so relationship fields use selects where data exists:
  - listing selects
  - branch/terminal/property selects
  - route selects
  - vehicle selects
  - schedule selects
  - driver selects
  - room type selects
  - room unit selects
  - seat selects when seat-map data exists
- Improved hotel creation flow so hotel property/room type/room unit actions use the hotel-specific endpoints instead of generic mixed forms.

## Rule

The existing Super Admin dashboard shell remains the only dashboard UI. These changes improve functionality and field correctness only.
