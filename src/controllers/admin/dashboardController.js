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
  const [dashboardData, companies, notificationRows, notificationCount] = await Promise.all([
    mongoDashboardService.roleDashboard(role),
    role === 'admin' ? mongoDashboardService.listEntity('companies', {}, { limit: 250 }) : Promise.resolve([]),
    notificationService.dashboardRowsLive(role, {}),
    notificationService.unreadCountLive(role, {}),
  ]);
  res.render(`dashboards/${role}/index`, {
    seo: { title },
    dashboardData: { ...dashboardData, notifications: notificationRows, dashboardFeatures: { services: SERVICE_DASHBOARDS, roles: ROLE_DASHBOARD_FEATURES } },
    dashboardShell: buildDashboardShell(role, {
      user: req.session?.user,
      companies,
      notifications: notificationRows,
      notificationCount,
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
  content: roleDashboard('content', 'Content dashboard | Classic Trip'),
};
