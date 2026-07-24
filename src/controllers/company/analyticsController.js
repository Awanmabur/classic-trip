const reportingRepository = require('../../repositories/domain/reportingRepository');
const { resolveCompanyId } = require('../../utils/companyScope');
async function summary(req, res, next) {
  try {
    const companyId = resolveCompanyId(req, { allowOverride: true });
    const [listings, bookings, campaigns] = await Promise.all([
      reportingRepository.listings.count({ companyId }), reportingRepository.bookings.count({ companyId }), reportingRepository.promotionCampaigns?.count?.({ companyId }) || reportingRepository.offlineSales.count({ companyId: '__none__' }),
    ]);
    res.json({ listings, bookings, campaigns });
  } catch (error) { next(error); }
}
module.exports = { summary };
