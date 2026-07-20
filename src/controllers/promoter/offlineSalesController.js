const offlineSalesService = require('../../services/promoter/offlineSalesService');

async function create(req, res, next) {
  try {
    await offlineSalesService.createOfflineSale(req.body, { agentId: req.session?.user?.id || 'user-promoter-001' });
    res.redirect('/promoter/dashboard#offline-sales');
  } catch (error) {
    next(error);
  }
}

function receipt(req, res, next) {
  const data = offlineSalesService.receiptForSale(req.params.id, req.session?.user?.id || 'user-promoter-001');
  if (!data) return next();
  return res.render('pages/offline-sale-receipt', {
    seo: { title: `${data.sale.receiptRef} receipt | Classic Trip` },
    ...data,
  });
}

module.exports = { create, receipt };
