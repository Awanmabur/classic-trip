const store = require('../../services/data/persistentStore');
function index(req, res) {
  const promoterId = req.session?.user?.id;
  res.json(store.state.walletTransactions.filter((txn) => txn.ownerType === 'promoter' && txn.ownerId === promoterId));
}
module.exports = { index };
