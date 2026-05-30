const walletService = require('../../services/wallet/walletService');

function request(req, res, next) {
  try {
    walletService.requestWithdrawal('promoter', req.session?.user?.id || 'user-promoter-001', Number(req.body.amount || 0), {
      currency: req.body.currency || 'UGX',
      referenceType: 'withdrawal',
      referenceId: `withdrawal-${Date.now()}`,
    });
    res.redirect('/promoter/withdrawals');
  } catch (error) {
    next(error);
  }
}

module.exports = { request };
