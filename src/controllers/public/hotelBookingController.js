const hotelService = require('../../services/hotel/hotelService');
const ticketAccessService = require('../../services/booking/ticketAccessService');
const { stripClientSuppliedIdentity } = require('../../utils/sanitizePublicPayload');
const { safePaymentRedirect } = require('../../utils/paymentRedirect');

async function create(req, res, next) {
  try {
    const booking = await hotelService.createHotelBooking(stripClientSuppliedIdentity(req.body), req);
    ticketAccessService.grantSessionAccess(req, booking.bookingRef);
    if (booking.checkoutUrl && booking.paymentStatus !== 'successful') return res.redirect(safePaymentRedirect(booking.checkoutUrl, `/tickets?bookingRef=${encodeURIComponent(booking.bookingRef)}`));
    res.redirect(`/booking/success/${booking.bookingRef}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { create };
