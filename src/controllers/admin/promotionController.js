const store = require('../../services/data/demoStore');
function list(req, res) { res.json(store.state.promotionCampaigns); }
module.exports = { list };
