const store = require('../../services/data/persistentStore');
const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const notificationService = require('../../services/notification/notificationService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');
const { resolveCompanyId } = require('../../utils/companyScope');

function scopedServices(serviceProfile = {}) {
  const type = serviceProfile.primaryServiceType;
  return type ? SERVICE_DASHBOARDS.filter((service) => service.serviceType === type) : [];
}

async function index(req, res, next) {
  try {
    const companyId = resolveCompanyId(req);
    const dashboardData = await mongoDashboardService.roleDashboard('employee', { companyId });
    const companyDashboardData = await mongoDashboardService.roleDashboard('company', { companyId });
    const notificationContext = { companyId, employeeId: req.session?.user?.id || '' };
    const notificationRows = notificationService.dashboardRows('employee', notificationContext);
    res.render('dashboards/admin/index', {
      seo: { title: 'Employee dashboard | Classic Trip' },
      dashboardData: {
        ...dashboardData,
        notifications: notificationRows,
        company: dashboardData.company || companyDashboardData.company,
        serviceProfile: dashboardData.serviceProfile || companyDashboardData.serviceProfile,
        dashboardFeatures: { services: scopedServices(companyDashboardData.serviceProfile), roles: ROLE_DASHBOARD_FEATURES },
      },
      dashboardShell: buildDashboardShell('employee', {
        user: req.session?.user,
        companyId,
        companies: store.state.companies,
        notifications: notificationRows,
        notificationCount: notificationService.unreadCount('employee', notificationContext),
        activePage: req.params?.page || 'overview',
        company: companyDashboardData.company,
        serviceProfile: companyDashboardData.serviceProfile,
      }),
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { index };
