const workflowService = require('../../services/support/workflowService');
const customerService = require('../../services/customer/customerService');
const { pushFlash } = require('../../middlewares/flash');

async function requestRefund(req, res, next) {
  try {
    const user = await customerService.requireSessionUser(req);
    const booking = await customerService.findOwnedBooking(req.body.bookingRef, user);
    if (!booking) {
      pushFlash(req, 'error', 'You do not have permission to request a refund for this booking.');
      return res.redirect('/account/bookings');
    }
    const customerRepository = require('../../repositories/domain/customerRepository');
    await Promise.resolve(workflowService.requestRefund({ bookingRef: booking.bookingRef, requesterId: user.id, amount: req.body.amount, reason: req.body.reason }));
    return res.redirect('/account/bookings');
  } catch (error) { return next(error); }
}

module.exports = { requestRefund };
