# Classic Trip fare, add-on, return-ticket, and seat-layout completion

## What fare plans are for

A **fare plan** is an internal reusable commercial rule set owned by a partner. It defines the passenger class, currency, baggage allowance, refund rule, change rule, and other conditions that can be reused across scheduled departures on a route.

Travelers should not need to understand or choose an internal fare-plan record. On public cards and the listing preview, Classic Trip now shows only the useful result: the selected journey fare per seat and the relevant baggage, refund, and change conditions.

## What stop-to-stop prices are for

A **stop-to-stop price** is the actual amount charged between two ordered stops on the same route. It supports journeys such as Kampala to Jinja, Kampala to Mbale, or Jinja to Mbale without forcing every traveler to pay the full origin-to-final-destination fare.

The boarding stop must occur before the drop-off stop. The server resolves the correct stop-to-stop price for the selected journey and never trusts a price submitted by the browser.

## Partner-managed optional extras

Partner admins can create, edit, pause, archive, order, and attach optional extras to one of their bus listings. Starter templates include:

- Extra luggage - UGX 12,000
- Priority boarding - UGX 8,000
- SMS and WhatsApp ticket - UGX 2,500
- Travel insurance
- Meal pack
- Terminal lounge access
- Flexible ticket change
- Premium Wi-Fi

Each extra can be charged once per booking, per traveler, per trip leg, or per traveler per leg. It can also be limited to one-way bookings, return bookings, or both. Currency is inherited from the selected listing; UGX starter prices are not silently copied onto non-UGX services.

The selected extras appear on the public preview, checkout summary, booking record, confirmation page, web ticket, and generated PDF ticket. Prices are recalculated and snapshotted on the server to prevent client-side price tampering.

The paid SMS and WhatsApp ticket extra is connected to the confirmation-notification outbox. Standard confirmations use in-app, push, and email channels; SMS and WhatsApp are added when the communication extra is part of the confirmed booking.

## Return-ticket behavior

A return ticket is one booking containing two connected journey legs:

1. The outbound schedule and outbound seats.
2. A reverse-route schedule that departs after the outbound journey arrives, with the same number of return seats.

Both legs are held and confirmed together. Checkout displays both journeys and their seats. Every traveler receives a separate ticket/QR for each leg. If payment fails, booking inventory is released and no successful booking or money record is created.

Changing outbound seats clears any earlier return-seat selection so an old return selection cannot be submitted with the wrong traveler count. The browser provides early guidance, while the server performs the final chronology, route, inventory, passenger-count, fare, and add-on validations.

## Seat-layout consistency

Seat rendering is no longer a fixed 2x2 or 2x1 grid. Public preview, return selection, partner seat-map preview, and live departure operations now derive rows, columns, left/right seat groups, and aisle placement from the saved vehicle layout and seat records.

Supported named layouts are:

- 1x1
- 1x2
- 2x1
- 2x2
- 2x3
- 3x2
- 3x3
- Sleeper
- Custom

Custom layouts continue to use the saved seat row, column, and side data instead of forcing a predefined arrangement.

## Public listing-card cleanup

Public bus cards now focus on the operator, route, departure, availability, amenities, and starting fare per seat. Internal fare-plan names and technical segment records are not exposed on the card or listing preview.
