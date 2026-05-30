const store = require('../../services/data/demoStore');
function index(req, res) { res.json(store.state.walletTransactions.filter((txn) => txn.ownerType === 'promoter')); }
module.exports = { index };
