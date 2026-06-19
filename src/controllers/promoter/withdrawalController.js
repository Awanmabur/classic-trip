const settlementService = require('../../services/finance/settlementService');

async function request(req, res, next) {
  try {
    const promoterId = req.session?.user?.id || 'user-promoter-001';
    await settlementService.requestOwnerPayout('promoter', promoterId, Number(req.body.amount || 0), req.body, promoterId);
    res.redirect('/promoter/withdrawals');
  } catch (error) {
    next(error);
  }
}

module.exports = { request };
