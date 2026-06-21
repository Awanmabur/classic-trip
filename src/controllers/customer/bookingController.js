const bookingService = require('../../services/booking/bookingService');
const { pushFlash } = require('../../middlewares/flash');

async function cancel(req, res, next) {
  try {
    const booking = bookingService.lookupBooking(req.params.bookingRef);
    if (!booking) {
      pushFlash(req, 'error', 'Booking not found.');
      return res.redirect('/account/bookings');
    }
    const userId = req.session?.user?.id;
    if (booking.customerUserId && String(booking.customerUserId) !== String(userId)) {
      pushFlash(req, 'error', 'You do not have permission to cancel this booking.');
      return res.redirect('/account/bookings');
    }
    const cancelled = bookingService.cancelBooking(req.params.bookingRef, req.body.reason || 'Customer requested cancellation');
    if (!cancelled) {
      pushFlash(req, 'error', 'Booking could not be cancelled.');
      return res.redirect('/account/bookings');
    }
    pushFlash(req, 'success', `Booking ${req.params.bookingRef} has been cancelled.`);
    return res.redirect('/account/bookings');
  } catch (error) {
    return next(error);
  }
}

module.exports = { cancel };
