async function toDataUrl(value) {
  try {
    const QRCode = require('qrcode');
    return QRCode.toDataURL(value);
  } catch (error) {
    return null;
  }
}

function valueForBooking(booking) {
  return booking.qrCodeValue || `CLASSIC-TRIP:${booking.bookingRef}`;
}

module.exports = { toDataUrl, valueForBooking };
