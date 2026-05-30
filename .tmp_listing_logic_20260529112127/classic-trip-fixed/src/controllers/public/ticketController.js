const { asyncHandler } = require("../../middleware/http");
const { Booking } = require("../../models/shared");
const { serializePublicBooking } = require("../../services/shared/bookings");
const { toSvg, toDataUri } = require("../../utils/qr");

/**
 * GET /api/public/tickets/:lookupCode/qr
 * Public – anyone with the booking lookup code can fetch the QR.
 * Returns JSON with { qrSvg, qrDataUri, booking }.
 */
exports.getTicketQr = asyncHandler(async (req, res) => {
  const lookupCode = String(req.params.lookupCode || "").trim().toUpperCase();
  if (!lookupCode) return res.status(400).json({ ok: false, message: "lookupCode required" });

  const booking = await Booking.findOne({
    $or: [
      { guestLookupCode: lookupCode },
      { guestLookupCode: lookupCode.replace(/^GT-/, "") }
    ]
  }).populate("userId", "name email phone").lean();

  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });

  if (booking.status !== "confirmed") {
    return res.status(200).json({
      ok: false,
      message: `Booking is ${booking.status}. QR ticket is only available for confirmed bookings.`,
      booking: serializePublicBooking(booking)
    });
  }

  // QR payload: the lookup code is the canonical ticket identifier
  const qrPayload = booking.guestLookupCode || String(booking._id);
  const qrSvg = toSvg(qrPayload, { size: 280, margin: 8 });
  const qrDataUri = toDataUri(qrPayload, { size: 280, margin: 8 });

  res.json({
    ok: true,
    lookupCode: qrPayload,
    qrSvg,
    qrDataUri,
    booking: serializePublicBooking(booking)
  });
});

/**
 * GET /api/public/tickets/:lookupCode/qr.svg
 * Returns the raw SVG image directly (for embedding as <img src="...">).
 */
exports.getTicketQrSvg = asyncHandler(async (req, res) => {
  const lookupCode = String(req.params.lookupCode || "").trim().toUpperCase();
  if (!lookupCode) return res.status(400).send("lookupCode required");

  const booking = await Booking.findOne({
    guestLookupCode: lookupCode
  }).lean();

  if (!booking) return res.status(404).send("Booking not found");

  const qrPayload = booking.guestLookupCode || String(booking._id);
  const svg = toSvg(qrPayload, { size: 280, margin: 8 });

  res.set("Content-Type", "image/svg+xml");
  res.set("Cache-Control", "no-store");
  res.send(svg);
});
