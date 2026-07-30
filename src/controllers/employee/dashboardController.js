const { buildDashboardShell, employeePageAllowed } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');
const { resolveCompanyId } = require('../../utils/companyScope');
const { effectivePermissionsFresh } = require('../../middlewares/permissions');
const archiveService = require('../../services/archive/archiveService');

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
    const archiveRows = activePage === 'archive'
      ? await archiveService.listForDashboard('employee', { companyId })
      : [];
    const notificationRows = Array.isArray(dashboardData.notifications) ? dashboardData.notifications : [];
    const notificationCount = notificationRows.filter((row) => {
      const status = String(Array.isArray(row) ? (row[4] || row[5] || '') : row.status || '').toLowerCase();
      return !['read', 'dismissed', 'archived'].includes(status);
    }).length;
    const companies = dashboardData.company ? [dashboardData.company] : [];
    res.render('dashboards/employee/index', {
      seo: { title: 'Employee dashboard | Classic Trip' },
      dashboardData: {
        ...dashboardData,
        archiveRows,
        notifications: notificationRows,
        dashboardFeatures: { services: scopedServices(dashboardData.serviceProfile), roles: ROLE_DASHBOARD_FEATURES },
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
        company: dashboardData.company,
        serviceProfile: dashboardData.serviceProfile,
      }),
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { index };
