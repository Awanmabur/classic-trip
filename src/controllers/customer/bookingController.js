const bookingService = require('../../services/booking/bookingService');
const store = require('../../services/data/persistentStore');
const { pushFlash } = require('../../middlewares/flash');
const { ownsBooking } = require('../../utils/bookingOwnership');

async function cancel(req, res, next) {
  try {
    const booking = store.findBooking(req.params.bookingRef);
    if (!booking) {
      pushFlash(req, 'error', 'Booking not found.');
      return res.redirect('/account/bookings');
    }
    const user = req.session?.user || {};
    if (!ownsBooking(booking, user)) {
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
