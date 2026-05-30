const store = require('../../services/data/demoStore');
function summary(req, res) { res.json({ listings: store.state.listings.length, bookings: store.state.bookings.length, campaigns: store.state.promotionCampaigns.length }); }
module.exports = { summary };
