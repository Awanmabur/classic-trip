const store = require('../../services/data/persistentStore');
const billingService = require('../../services/billing/billingService');
const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const notificationService = require('../../services/notification/notificationService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');
const { resolveCompanyId } = require('../../utils/companyScope');

function requestedPageFromRequest(req) {
  const raw = req.params?.page || '';
  const path = String(req.path || '');
  const aliases = {
    '/company/dashboard': 'overview',
    '/company/listings': 'listings',
    '/company/bus-listings': 'listings',
    '/company/routes': 'routes',
    '/company/routes-stops': 'routes',
    '/company/vehicles': 'vehicles',
    '/company/schedules': 'schedules',
    '/company/schedules-fares': 'schedules',
    '/company/rooms': 'hotel-rooms',
    '/company/hotel-rooms': 'hotel-rooms',
    '/company/hotel-properties': 'hotel-rooms',
    '/company/room-types': 'hotel-rooms',
    '/company/room-units': 'hotel-rooms',
    '/company/room-calendar': 'hotel-rooms',
    '/company/arrivals': 'manifests',
    '/company/departures': 'manifests',
    '/company/in-house-guests': 'manifests',
    '/company/housekeeping': 'hotel-rooms',
    '/company/bookings': 'bookings',
    '/company/checkins': 'checkins',
    '/company/boarding-checkins': 'checkins',
    '/company/employees': 'staff',
    '/company/staff': 'staff',
    '/company/driver-requests': 'staff',
    '/company/profile': 'company-profile',
    '/company/payouts': 'settlement',
    '/company/settlement': 'settlement',
    '/company/revenue': 'revenue',
    '/company/analytics': 'reports',
    '/company/reports': 'reports',
    '/company/support': 'support',
    '/company/seat-maps': 'seat-maps',
    '/company/manifests-dashboard': 'manifests',
    '/company/passenger-manifests': 'manifests',
  };
  return raw || aliases[path] || 'overview';
}

function allowedCompanyPage(page, serviceProfile = {}) {
  const serviceDashboardPages = new Set(SERVICE_DASHBOARDS.map((service) => service.key));
  if (serviceDashboardPages.has(page)) return 'overview';
  const visiblePages = new Set(serviceProfile.visiblePages || []);
  return visiblePages.has(page) ? page : 'overview';
}

function companyServiceDashboards(serviceProfile = {}) {
  const serviceType = serviceProfile.primaryServiceType;
  if (!serviceType || serviceType === 'partner') return [];
  return SERVICE_DASHBOARDS.filter((service) => service.serviceType === serviceType);
}

async function index(req, res, next) {
  try {
    const companyId = resolveCompanyId(req);
    const baseDashboardData = await mongoDashboardService.roleDashboard('company', { companyId });
    const dashboardData = {
      ...baseDashboardData,
      dashboardFeatures: { services: companyServiceDashboards(baseDashboardData.serviceProfile), roles: ROLE_DASHBOARD_FEATURES },
      billing: billingService.companyBillingSummary(companyId),
    };
    const companies = store.state.companies;
    const notificationContext = { companyId };
    const notificationRows = notificationService.dashboardRows('company', notificationContext);
    dashboardData.notifications = notificationRows;
    res.render('dashboards/admin/index', {
      seo: { title: `${dashboardData.serviceProfile?.dashboardLabel || 'Company'} dashboard | Classic Trip` },
      dashboardData,
      dashboardShell: buildDashboardShell('company', {
        user: req.session?.user,
        activePage: allowedCompanyPage(requestedPageFromRequest(req), dashboardData.serviceProfile),
        companyId,
        company: dashboardData.company,
        serviceProfile: dashboardData.serviceProfile,
        companies: companies.length ? companies : store.state.companies,
        notifications: notificationRows,
        notificationCount: notificationService.unreadCount('company', notificationContext),
      }),
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { index };
