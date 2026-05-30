const walletService = require('../../services/wallet/walletService');

function approve(req, res) {
  walletService.approveWithdrawal(req.params.id, req.session?.user?.id || 'admin-system');
  res.redirect('/admin/withdrawals');
}

module.exports = { approve };
