const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const refundWorkflowService = require('../../services/support/workflowService');

function actorId(req) {
  return req.session?.user?.id || req.user?.id || 'admin-system';
}

function wantsJson(req) {
  return req.xhr || req.headers.accept?.includes('application/json');
}

function sendResult(req, res, payload, fallback = '/admin/refunds') {
  if (wantsJson(req)) return res.json(payload);
  return res.redirect(fallback);
}

async function list(req, res, next) {
  try {
    res.json(await mongoDashboardService.listEntity('supportTickets', {}, { limit: req.query.limit || 500 }));
  } catch (error) {
    next(error);
  }
}

async function approveRefund(req, res, next) {
  try {
    const refund = await refundWorkflowService.approveRefund(req.params.id, actorId(req));
    return sendResult(req, res, { ok: true, refund }, '/admin/refunds');
  } catch (error) {
    next(error);
  }
}

async function rejectRefund(req, res, next) {
  try {
    const refund = await refundWorkflowService.rejectRefund(
      req.params.id,
      actorId(req),
      req.body?.reason || req.body?.rejectionReason || 'Refund rejected after review'
    );
    return sendResult(req, res, { ok: true, refund }, '/admin/refunds');
  } catch (error) {
    next(error);
  }
}

module.exports = { list, approveRefund, rejectRefund };
