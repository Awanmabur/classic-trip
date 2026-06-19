# Bus Seat Preview Selection and Color Pass

This pass improves the bus seat-map presentation in both the company dashboard and public listing pages.

## Changes

- Dashboard visual seat preview now uses the same colors as the legend:
  - Available: green
  - Booked: yellow
  - Held: blue
  - Blocked / maintenance: orange-red
- Bus cabin preview is slimmer and taller so it looks more like a real bus aisle layout.
- Dashboard seats now display labels as `Seat No.` plus the seat number.
- Public bus listing seats and return-trip seats now also display `Seat No.` labels.
- Public bus seat colors now follow the same status logic for available, booked/taken, held/locked, blocked, and maintenance.
- Seat Maps page now asks the user to select a route/schedule first.
- Only the selected route/schedule seat map is shown in the visual preview.
- The seat-map list table is now shown after the visual preview and scoped to the selected route/schedule.
- A shortcut button scrolls from the selected map to the list table.

## Files changed

- `src/views/dashboards/admin/index.ejs`
- `src/views/pages/listing-details.ejs`
- `public/css/pages/home.css`

## Verification

- `npm run check`
- `npm run check:dashboards`
