const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const notificationService = require('../../services/notification/notificationService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');
const { resolveCustomerId } = require('../../utils/customerScope');

async function index(req, res, next) {
  try {
    const customerId = resolveCustomerId(req);
    const dashboardData = await mongoDashboardService.roleDashboard('customer', { customerId });
    const notificationContext = { customerId, email: req.session?.user?.email || '', phone: req.session?.user?.phone || '' };
    const [notificationRows, notificationCount] = await Promise.all([notificationService.dashboardRowsLive('customer', notificationContext), notificationService.unreadCountLive('customer', notificationContext)]);
    res.render('dashboards/customer/index', {
      seo: { title: 'Customer dashboard | Classic Trip' },
      dashboardData: { ...dashboardData, notifications: notificationRows, dashboardFeatures: { services: SERVICE_DASHBOARDS, roles: ROLE_DASHBOARD_FEATURES } },
      dashboardShell: buildDashboardShell('customer', {
        user: req.session?.user,
        notifications: notificationRows,
        notificationCount,
        activePage: req.params?.page || (String(req.path || '').split('/').filter(Boolean).pop() === 'account' ? 'overview' : String(req.path || '').split('/').filter(Boolean).pop()),
      }),
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { index };
