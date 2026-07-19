const workflowService = require('../../services/support/workflowService');
const store = require('../../services/data/persistentStore');
const { pushFlash } = require('../../middlewares/flash');
const { ownsBooking } = require('../../utils/bookingOwnership');

function requestRefund(req, res, next) {
  try {
    const user = req.session?.user || {};
    const userId = user.id;
    const booking = store.findBooking(req.body.bookingRef);
    if (!booking || !ownsBooking(booking, user)) {
      pushFlash(req, 'error', 'You do not have permission to request a refund for this booking.');
      return res.redirect('/account/bookings');
    }
    workflowService.requestRefund({
      bookingRef: req.body.bookingRef,
      requesterId: userId || 'guest',
      amount: req.body.amount,
      reason: req.body.reason,
    });
    return res.redirect('/account/bookings');
  } catch (error) {
    return next(error);
  }
}

module.exports = { requestRefund };
