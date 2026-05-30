const store = require('../../services/data/demoStore');

function index(req, res) {
  res.render("dashboards/company/index", {
    seo: { title: "Partner company dashboard | Classic Trip" },
    dashboardData: store.dashboardData('company', { companyId: req.session?.user?.companyId || 'company-01' }),
  });
}
module.exports = { index };
