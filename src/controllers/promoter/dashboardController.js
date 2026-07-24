const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const notificationService = require('../../services/notification/notificationService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');
const { resolvePromoterId } = require('../../utils/promoterScope');

async function index(req, res, next) {
  try {
    const promoterId = resolvePromoterId(req);
    const dashboardData = await mongoDashboardService.roleDashboard('promoter', { promoterId });
    const notificationContext = { promoterId };
    const [notificationRows, notificationCount] = await Promise.all([notificationService.dashboardRowsLive('promoter', notificationContext), notificationService.unreadCountLive('promoter', notificationContext)]);
    res.render('dashboards/promoter/index', {
      seo: { title: 'Promoter dashboard | Classic Trip' },
      dashboardData: { ...dashboardData, notifications: notificationRows, dashboardFeatures: { services: SERVICE_DASHBOARDS, roles: ROLE_DASHBOARD_FEATURES } },
      dashboardShell: buildDashboardShell('promoter', {
        user: req.session?.user,
        notifications: notificationRows,
        notificationCount,
        activePage: req.params?.page || (String(req.path || '').split('/').filter(Boolean).pop() === 'dashboard' ? 'overview' : String(req.path || '').split('/').filter(Boolean).pop()),
      }),
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { index };
