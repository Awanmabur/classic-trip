const store = require('../../services/data/persistentStore');
const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');

async function index(req, res, next) {
  try {
    const customerId = req.session?.user?.id || 'user-customer-001';
    const dashboardData = await mongoDashboardService.roleDashboard('customer', { customerId });
    res.render('dashboards/admin/index', {
      seo: { title: 'Customer dashboard | Classic Trip' },
      dashboardData: { ...dashboardData, dashboardFeatures: { services: SERVICE_DASHBOARDS, roles: ROLE_DASHBOARD_FEATURES } },
      dashboardShell: buildDashboardShell('customer', {
        user: req.session?.user,
        notificationCount: store.state.notifications?.filter((note) => note.ownerId === customerId || note.ownerType === 'customer').length || 0,
        activePage: req.params?.page || (String(req.path || '').split('/').filter(Boolean).pop() === 'account' ? 'overview' : String(req.path || '').split('/').filter(Boolean).pop()),
      }),
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { index };
