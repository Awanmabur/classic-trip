const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');
const { resolvePromoterId } = require('../../utils/promoterScope');
const archiveService = require('../../services/archive/archiveService');

async function index(req, res, next) {
  try {
    const promoterId = resolvePromoterId(req);
    const activePage = req.params?.page || (String(req.path || '').split('/').filter(Boolean).pop() === 'dashboard' ? 'overview' : String(req.path || '').split('/').filter(Boolean).pop());
    const dashboardData = await mongoDashboardService.roleDashboard('promoter', { promoterId, activePage });
    const archiveRows = activePage === 'archive'
      ? await archiveService.listForDashboard('promoter', { promoterId })
      : [];
    const notificationRows = Array.isArray(dashboardData.notifications) ? dashboardData.notifications : [];
    const notificationCount = notificationRows.filter((row) => {
      const status = String(Array.isArray(row) ? (row[4] || row[5] || '') : row.status || '').toLowerCase();
      return !['read', 'dismissed', 'archived'].includes(status);
    }).length;
    res.render('dashboards/promoter/index', {
      seo: { title: 'Promoter dashboard | Classic Trip' },
      dashboardData: { ...dashboardData, archiveRows, notifications: notificationRows, dashboardFeatures: { services: SERVICE_DASHBOARDS, roles: ROLE_DASHBOARD_FEATURES } },
      dashboardShell: buildDashboardShell('promoter', {
        user: req.session?.user,
        notifications: notificationRows,
        notificationCount,
        activePage,
      }),
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { index };
