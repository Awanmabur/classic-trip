const { buildDashboardShell, employeePageAllowed } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const notificationService = require('../../services/notification/notificationService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');
const { resolveCompanyId } = require('../../utils/companyScope');
const { effectivePermissionsFresh } = require('../../middlewares/permissions');

function scopedServices(serviceProfile = {}) {
  const type = serviceProfile.primaryServiceType;
  return type ? SERVICE_DASHBOARDS.filter((service) => service.serviceType === type) : [];
}

async function index(req, res, next) {
  try {
    const companyId = resolveCompanyId(req);
    const employeeId = req.session?.user?.id || '';
    const activePage = String(req.params?.page || 'overview').trim().toLowerCase();
    const permissions = await effectivePermissionsFresh(req.session?.user || {});
    if (!employeePageAllowed(activePage, permissions)) {
      const error = new Error('You do not have permission to open this staff dashboard page');
      error.status = 403;
      throw error;
    }
    const dashboardData = await mongoDashboardService.roleDashboard('employee', { companyId, employeeId, permissions, activePage });
    const companyDashboardData = await mongoDashboardService.roleDashboard('company', { companyId });
    const notificationContext = { companyId, employeeId };
    const [notificationRows, notificationCount] = await Promise.all([
      notificationService.dashboardRowsLive('employee', notificationContext),
      notificationService.unreadCountLive('employee', notificationContext),
    ]);
    const companies = companyDashboardData.company ? [companyDashboardData.company] : [];
    res.render('dashboards/employee/index', {
      seo: { title: 'Employee dashboard | Classic Trip' },
      dashboardData: {
        ...dashboardData,
        notifications: notificationRows,
        company: dashboardData.company || companyDashboardData.company,
        serviceProfile: dashboardData.serviceProfile || companyDashboardData.serviceProfile,
        dashboardFeatures: { services: scopedServices(companyDashboardData.serviceProfile), roles: ROLE_DASHBOARD_FEATURES },
        permissions,
      },
      dashboardShell: buildDashboardShell('employee', {
        user: req.session?.user,
        companyId,
        companies,
        notifications: notificationRows,
        notificationCount,
        activePage,
        permissions,
        company: companyDashboardData.company,
        serviceProfile: companyDashboardData.serviceProfile,
      }),
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { index };
