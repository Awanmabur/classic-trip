const store = require('../../services/data/demoStore');
const billingService = require('../../services/billing/billingService');

function index(req, res) {
  const companyId = req.session?.user?.companyId || 'company-01';
  res.render("dashboards/company/index", {
    seo: { title: "Partner company dashboard | Classic Trip" },
    dashboardData: {
      ...store.dashboardData('company', { companyId }),
      billing: billingService.companyBillingSummary(companyId),
    },
  });
}
module.exports = { index };
