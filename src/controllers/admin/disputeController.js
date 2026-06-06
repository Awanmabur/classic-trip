const store = require('../../services/data/demoStore');
function list(req, res) { res.json(store.state.supportTickets); }
const workflowService = require('../../services/support/workflowService');

function approveRefund(req, res, next) {
  try {
    workflowService.approveRefund(req.params.id, req.session?.user?.id || 'admin-system');
    res.redirect('/admin/refunds');
  } catch (error) {
    next(error);
  }
}

function rejectRefund(req, res, next) {
  try {
    workflowService.rejectRefund(req.params.id, req.session?.user?.id || 'admin-system', req.body.reason || 'Rejected by admin review');
    res.redirect('/admin/refunds');
  } catch (error) {
    next(error);
  }
}

module.exports = { list, approveRefund, rejectRefund };
