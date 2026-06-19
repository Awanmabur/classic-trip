const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const actionController = require('./actionController');

async function list(req, res, next) {
  try {
    res.json(await mongoDashboardService.listEntity('promotionCampaigns', {}, { limit: req.query.limit || 500 }));
  } catch (error) {
    next(error);
  }
}

module.exports = { list, create: actionController.createPromotion };
