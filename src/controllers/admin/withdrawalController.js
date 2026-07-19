const walletService = require('../../services/wallet/walletService');
const store = require('../../services/data/persistentStore');

function approve(req, res, next) {
  try {
    const actorId = req.session?.user?.id || 'admin-system';
    const transaction = walletService.approveWithdrawal(req.params.id, actorId);
    store.state.auditLogs.unshift({
      id: `audit-${store.state.auditLogs.length + 1}`,
      actorId,
      action: 'admin.withdrawal.approved',
      target: req.params.id,
      status: transaction ? 'success' : 'not_found',
      createdAt: new Date().toISOString(),
    });
    res.redirect('/admin/withdrawals');
  } catch (error) {
    next(error);
  }
}

module.exports = { approve };
