const workflowService = require('../../services/support/workflowService');

function create(req, res, next) {
  try {
    workflowService.createReview({
      bookingRef: req.body.bookingRef,
      customerUserId: req.session?.user?.id || null,
      rating: req.body.rating,
      comment: req.body.comment,
    });
    res.redirect('/account');
  } catch (error) {
    next(error);
  }
}

module.exports = { create };
