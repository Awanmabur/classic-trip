const settlementService = require('../../services/finance/settlementService');
const walletService = require('../../services/wallet/walletService');

function actorId(req) {
  return req.session?.user?.id || 'admin-system';
}

function redirect(res, path = '/admin/payments') {
  res.redirect(path);
}

async function reviewTopUp(req, res, next) {
  try {
    await walletService.reviewTopUpRequest(req.params.id, req.body.action, actorId(req), { reason: req.body.reason });
    redirect(res, '/admin/payments');
  } catch (error) {
    next(error);
  }
}

async function releaseEligible(req, res, next) {
  try {
    await settlementService.releaseEligibleEarnings(actorId(req));
    redirect(res, '/admin/payments');
  } catch (error) {
    next(error);
  }
}

async function createSettlement(req, res, next) {
  try {
    await settlementService.createSettlementBatch(req.body, actorId(req));
    redirect(res, '/admin/payments');
  } catch (error) {
    next(error);
  }
}

async function syncPayouts(req, res, next) {
  try {
    await settlementService.syncPayoutRequests(actorId(req));
    redirect(res, '/admin/payments');
  } catch (error) {
    next(error);
  }
}

async function reviewPayout(req, res, next) {
  try {
    const result = await settlementService.reviewPayoutRequest(req.params.id, req.body, actorId(req));
    await settlementService.notifyPayoutResult(result);
    redirect(res, '/admin/payments');
  } catch (error) {
    next(error);
  }
}

async function createPayoutBatch(req, res, next) {
  try {
    await settlementService.createPayoutBatch(req.body, actorId(req));
    redirect(res, '/admin/payments');
  } catch (error) {
    next(error);
  }
}


async function generateStatements(req, res, next) {
  try {
    await settlementService.generateFinanceStatements(req.body, actorId(req));
    redirect(res, '/admin/payments');
  } catch (error) {
    next(error);
  }
}

async function reconcile(req, res, next) {
  try {
    await settlementService.createReconciliationReport(req.body, actorId(req));
    redirect(res, '/admin/payments');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  releaseEligible,
  createSettlement,
  syncPayouts,
  reviewPayout,
  reviewTopUp,
  createPayoutBatch,
  generateStatements,
  reconcile,
};
