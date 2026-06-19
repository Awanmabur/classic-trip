const store = require('../../services/data/persistentStore');
const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');

async function index(req, res, next) {
  try {
    const promoterId = req.session?.user?.id || 'user-promoter-001';
    const dashboardData = await mongoDashboardService.roleDashboard('promoter', { promoterId });
    res.render('dashboards/admin/index', {
      seo: { title: 'Promoter dashboard | Classic Trip' },
      dashboardData: { ...dashboardData, dashboardFeatures: { services: SERVICE_DASHBOARDS, roles: ROLE_DASHBOARD_FEATURES } },
      dashboardShell: buildDashboardShell('promoter', {
        user: req.session?.user,
        notificationCount: store.state.notifications?.filter((note) => note.ownerId === promoterId || note.ownerType === 'promoter').length || 0,
        activePage: req.params?.page || (String(req.path || '').split('/').filter(Boolean).pop() === 'dashboard' ? 'overview' : String(req.path || '').split('/').filter(Boolean).pop()),
      }),
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { index };
