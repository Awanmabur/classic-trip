const workflowService = require('../../services/support/workflowService');
const store = require('../../services/data/persistentStore');
const { pushFlash } = require('../../middlewares/flash');

function create(req, res, next) {
  try {
    const userId = req.session?.user?.id;
    const booking = store.findBooking(req.body.bookingRef);
    if (booking && booking.customerUserId && String(booking.customerUserId) !== String(userId)) {
      pushFlash(req, 'error', 'You do not have permission to review this booking.');
      return res.redirect('/account');
    }
    workflowService.createReview({
      bookingRef: req.body.bookingRef,
      customerUserId: userId || null,
      rating: req.body.rating,
      comment: req.body.comment,
    });
    return res.redirect('/account');
  } catch (error) {
    return next(error);
  }
}

module.exports = { create };
