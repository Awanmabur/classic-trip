# Bus Seat Number, Color, and Responsive Preview Pass

This pass updates the bus seat preview and public booking seat selectors to match the requested seat UX.

## Completed

- Dashboard bus cabin preview now uses a slimmer and taller responsive cabin shape.
- Dashboard visual seats now display clean numeric labels: `Seat No. 1`, `Seat No. 2`, and onward.
- Public bus booking seats now display the same clean numeric labels instead of A1/B2-style labels.
- Seat map legend and seat colors now follow the requested status meaning:
  - Available: blue
  - Booked: red
  - Held: green
  - Selected: yellow
  - Blocked / maintenance: orange
- Homepage/demo seat selector now uses numeric `Seat No.` labels for bus seats.
- Existing internal seat values remain compatible with current booking/hold logic, while the customer/admin-facing labels are clean numeric labels.

## Checks

- `npm run check`
- `npm run check:dashboards`
