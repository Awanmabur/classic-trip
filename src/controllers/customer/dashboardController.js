const store = require('../../services/data/demoStore');

function index(req, res) {
  res.render('dashboards/customer/index', {
    seo: { title: 'Customer dashboard | Classic Trip' },
    dashboardData: store.dashboardData('customer', { customerId: req.session?.user?.id || 'user-customer-001' }),
  });
}
module.exports = { index };
