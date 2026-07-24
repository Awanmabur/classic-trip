const promotionService = require('../../services/promotion/promotionService');
const { resolveCompanyId } = require('../../utils/companyScope');
async function create(req, res, next) {
  try {
    const companyId = resolveCompanyId(req, { allowOverride: true });
    await promotionService.markSponsored(req.body.listingId, companyId, req.body, req.session?.user?.id || 'company-user');
    res.redirect('/company/promotions');
  } catch (error) { next(error); }
}
module.exports = { create };
