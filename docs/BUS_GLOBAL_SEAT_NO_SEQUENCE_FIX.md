# Bus Global Seat No Sequence Fix

This pass removes remaining legacy bus seat labels such as `Seat F3`, `A1`, `B2`, and `Seat Number` from the active application code.

## Rules now enforced

- Bus seats display as `Seat No 1`, `Seat No 2`, `Seat No 3`, and continue in numeric order.
- Generated bus seat database values remain clean numeric strings such as `1`, `2`, `3`.
- Existing backend field names such as `seatNumber` remain unchanged for compatibility, but the values are numeric.
- Legacy labels submitted by older pages, such as `Seat No 1`, `Seat Number 1`, or `A1`, are normalized before seat locking/booking.
- Payment, ticket, receipt, PDF ticket, dashboard, manifest, public listing preview, and homepage/demo seat selectors use the clean label.
- Seat cards keep equal width and height with consistent spacing across dashboard and public pages.

## Validation

`npm run check:dashboards` now also checks that `Seat Number` and visible legacy `Seat A1` style labels are not reintroduced in JS/EJS/CSS files.
