const promotionService = require('../../services/promotion/promotionService');
const { resolveCompanyId } = require('../../utils/companyScope');
function create(req, res, next) {
  try {
    const companyId = resolveCompanyId(req, { allowOverride: true });
    promotionService.markSponsored(req.body.listingId, companyId, req.body);
    res.redirect('/company/promotions');
  } catch (error) {
    next(error);
  }
}
module.exports = { create };
