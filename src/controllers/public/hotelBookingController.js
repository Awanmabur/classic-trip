const hotelService = require('../../services/hotel/hotelService');
const ticketAccessService = require('../../services/booking/ticketAccessService');

async function create(req, res, next) {
  try {
    const booking = await hotelService.createHotelBooking(req.body, req);
    ticketAccessService.grantSessionAccess(req, booking.bookingRef);
    if (booking.checkoutUrl && booking.paymentStatus !== 'successful') return res.redirect(booking.checkoutUrl);
    res.redirect(`/booking/success/${booking.bookingRef}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { create };
