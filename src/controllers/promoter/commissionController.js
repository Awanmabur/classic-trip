const promoterRepository = require('../../repositories/domain/promoterRepository');
const { resolvePromoterId } = require('../../utils/promoterScope');
async function index(req, res, next) {
  try {
    const promoterId = resolvePromoterId(req);
    const transactions = await promoterRepository.transactions.list({ ownerType: 'promoter', ownerId: promoterId }, { sort: { createdAt: -1 }, limit: 500 });
    return res.json(transactions);
  } catch (error) { return next(error); }
}
module.exports = { index };
