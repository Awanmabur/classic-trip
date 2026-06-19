const hotelService = require('../../services/hotel/hotelService');

async function create(req, res, next) {
  try {
    const booking = await hotelService.createHotelBooking(req.body, req);
    res.redirect(`/booking/success/${booking.bookingRef}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { create };
