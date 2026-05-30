const store = require('../services/data/demoStore');
function run() { return { wallets: store.state.wallets.length, pendingTransactions: store.state.walletTransactions.filter((t) => t.status === 'pending').length }; }
module.exports = { run };
