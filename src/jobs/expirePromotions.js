const store = require('../services/data/demoStore');
function run(now = new Date()) { let expired = 0; store.state.promotionCampaigns.forEach((c) => { if (c.endsAt && new Date(c.endsAt) < now) { c.status = 'expired'; expired += 1; } }); return expired; }
module.exports = { run };
