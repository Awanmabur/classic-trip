const store = require('../../services/data/demoStore');

function index(req, res) {
  res.render('dashboards/admin/index', {
    seo: { title: 'Super admin dashboard | Classic Trip' },
    dashboardData: store.dashboardData('admin'),
  });
}
module.exports = { index };
