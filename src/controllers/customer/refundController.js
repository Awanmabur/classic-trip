const workflowService = require('../../services/support/workflowService');

function requestRefund(req, res, next) {
  try {
    workflowService.requestRefund({
      bookingRef: req.body.bookingRef,
      requesterId: req.session?.user?.id || 'guest',
      amount: req.body.amount,
      reason: req.body.reason,
    });
    res.redirect('/account/bookings');
  } catch (error) {
    next(error);
  }
}

module.exports = { requestRefund };
