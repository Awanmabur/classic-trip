const store = require('../../services/data/demoStore');
function list(req, res) { res.json(store.state.promotionCampaigns); }
const actionController = require('./actionController');
module.exports = { list, create: actionController.createPromotion };
