const promoterService = require('../../services/promoter/promoterService');

function create(req, res, next) {
  try {
    promoterService.createLink({
      promoterId: req.session?.user?.id || 'user-promoter-001',
      listingId: req.body.listingId,
      code: req.body.code,
    });
    res.redirect('/promoter/links');
  } catch (error) {
    next(error);
  }
}

module.exports = { create };
