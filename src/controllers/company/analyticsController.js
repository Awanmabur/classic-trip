const store = require('../../services/data/persistentStore');
const { resolveCompanyId } = require('../../utils/companyScope');
function summary(req, res, next) {
  try {
    const companyId = resolveCompanyId(req, { allowOverride: true });
    res.json({
      listings: store.state.listings.filter((listing) => listing.companyId === companyId).length,
      bookings: store.state.bookings.filter((booking) => booking.companyId === companyId).length,
      campaigns: store.state.promotionCampaigns.filter((campaign) => campaign.companyId === companyId).length,
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { summary };
