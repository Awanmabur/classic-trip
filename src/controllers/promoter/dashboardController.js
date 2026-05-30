const store = require('../../services/data/demoStore');

function index(req, res) {
  res.render('dashboards/promoter/index', {
    seo: { title: 'Promoter dashboard | Classic Trip' },
    dashboardData: store.dashboardData('promoter', { promoterId: req.session?.user?.id || 'user-promoter-001' }),
  });
}
module.exports = { index };
