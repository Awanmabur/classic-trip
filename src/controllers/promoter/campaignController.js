const store = require('../../services/data/demoStore');
function index(req, res) { res.json(store.state.promotionCampaigns); }
module.exports = { index };
