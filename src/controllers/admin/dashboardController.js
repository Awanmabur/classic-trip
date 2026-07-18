const store = require('../../services/data/persistentStore');
const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const notificationService = require('../../services/notification/notificationService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');

function activePageFromRequest(req) {
  const path = String(req.path || '');
  const last = path.split('/').filter(Boolean).pop();
  if (!last || ['admin', 'dashboard', 'support', 'finance', 'operations'].includes(last)) return 'overview';
  const aliases = { companies: 'partners', withdrawals: 'payments', disputes: 'support', promotions: 'ads', reviews: 'reviews', reschedules: 'support' };
  return aliases[last] || last;
}

async function renderAdminShell(req, res, role, title) {
  const [dashboardData, companies, notifications] = await Promise.all([
    mongoDashboardService.roleDashboard('admin'),
    mongoDashboardService.listEntity('companies', {}, { limit: 250 }),
    mongoDashboardService.listEntity('notifications', {}, { limit: 250 }),
  ]);
  const notificationRows = notificationService.dashboardRows(role, {});
  res.render('dashboards/admin/index', {
    seo: { title },
    dashboardData: { ...dashboardData, notifications: notificationRows, dashboardFeatures: { services: SERVICE_DASHBOARDS, roles: ROLE_DASHBOARD_FEATURES } },
    dashboardShell: buildDashboardShell(role, {
      user: req.session?.user,
      companies: companies.length ? companies : store.state.companies,
      notifications: notificationRows,
      notificationCount: notificationService.unreadCount(role, {}),
        activePage: activePageFromRequest(req),
    }),
  });
}

function index(req, res, next) {
  renderAdminShell(req, res, 'admin', 'Super admin dashboard | Classic Trip').catch(next);
}

function roleDashboard(role, title) {
  return (req, res, next) => renderAdminShell(req, res, role, title).catch(next);
}

module.exports = {
  index,
  support: roleDashboard('support', 'Support dashboard | Classic Trip'),
  finance: roleDashboard('finance', 'Finance dashboard | Classic Trip'),
  operations: roleDashboard('operations', 'Operations dashboard | Classic Trip'),
};
