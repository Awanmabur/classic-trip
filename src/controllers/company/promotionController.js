const promotionService = require('../../services/promotion/promotionService');
function create(req, res, next) {
  try {
    promotionService.markSponsored(req.body.listingId, req.body);
    res.redirect('/company/promotions');
  } catch (error) {
    next(error);
  }
}
module.exports = { create };
