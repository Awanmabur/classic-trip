const bookingService = require('../../services/booking/bookingService');
const customerService = require('../../services/customer/customerService');
const { pushFlash } = require('../../middlewares/flash');

async function cancel(req, res, next) {
  try {
    const user = await customerService.requireSessionUser(req);
    const booking = await customerService.findOwnedBooking(req.params.bookingRef, user);
    if (!booking) {
      pushFlash(req, 'error', 'Booking not found or does not belong to your account.');
      return res.redirect('/account/bookings');
    }
    const cancelled = await bookingService.cancelBooking(req.params.bookingRef, req.body.reason || 'Customer requested cancellation', { actorId: user.id, actorRole: user.role });
    if (!cancelled) {
      pushFlash(req, 'error', 'Booking could not be cancelled.');
      return res.redirect('/account/bookings');
    }
    pushFlash(req, 'success', `Booking ${req.params.bookingRef} has been cancelled.`);
    return res.redirect('/account/bookings');
  } catch (error) { return next(error); }
}

module.exports = { cancel };
