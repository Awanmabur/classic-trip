const store = require('../../services/data/demoStore');

function index(req, res) {
  res.render('dashboards/employee/index', {
    seo: { title: 'Employee dashboard | Classic Trip' },
    dashboardData: store.dashboardData('employee', { companyId: req.session?.user?.companyId || 'company-01' }),
  });
}
module.exports = { index };
