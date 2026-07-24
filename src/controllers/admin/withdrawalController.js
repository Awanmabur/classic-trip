const walletService = require('../../services/wallet/walletService');
const reportingRepository = require('../../repositories/domain/reportingRepository');
const { nextId } = require('../../services/data/idService');
async function approve(req, res, next) {
  try {
    const actorId = req.session?.user?.id || 'admin-system';
    const transaction = await walletService.approveWithdrawalPersisted(req.params.id, actorId);
    const row = { id: await nextId('audit'), actorId, action: 'admin.withdrawal.approved', target: req.params.id, status: transaction ? 'success' : 'not_found', createdAt: new Date().toISOString() };
    await reportingRepository.auditLogs.save(row, { id: row.id });
    res.redirect('/admin/withdrawals');
  } catch (error) { next(error); }
}
module.exports = { approve };
