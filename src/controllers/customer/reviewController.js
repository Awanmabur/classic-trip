const workflowService = require('../../services/support/workflowService');
const customerService = require('../../services/customer/customerService');
const { pushFlash } = require('../../middlewares/flash');

async function create(req, res, next) {
  try {
    const user = await customerService.requireSessionUser(req);
    const booking = await customerService.findOwnedBooking(req.body.bookingRef, user);
    if (!booking) {
      pushFlash(req, 'error', 'You do not have permission to review this booking.');
      return res.redirect('/account');
    }
    const customerRepository = require('../../repositories/domain/customerRepository');
    await Promise.resolve(workflowService.createReview({ bookingRef: booking.bookingRef, customerUserId: user.id, rating: req.body.rating, comment: req.body.comment }));
    return res.redirect('/account');
  } catch (error) { return next(error); }
}

module.exports = { create };
