const offlineSalesService = require('../../services/promoter/offlineSalesService');
const { resolvePromoterId } = require('../../utils/promoterScope');

async function create(req, res, next) {
  try {
    await offlineSalesService.createOfflineSale(req.body, { agentId: resolvePromoterId(req) });
    res.redirect('/promoter/dashboard#offline-sales');
  } catch (error) {
    next(error);
  }
}

async function receipt(req, res, next) {
  const data = await offlineSalesService.receiptForSale(req.params.id, resolvePromoterId(req));
  if (!data) return next();
  return res.render('pages/offline-sale-receipt', {
    seo: { title: `${data.sale.receiptRef} receipt | Classic Trip` },
    ...data,
  });
}

module.exports = { create, receipt };
