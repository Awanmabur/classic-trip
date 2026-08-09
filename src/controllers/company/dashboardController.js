const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');
const { resolveCompanyId } = require('../../utils/companyScope');
const archiveService = require('../../services/archive/archiveService');

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
    '/company/rate-plans': 'hotel-rooms',
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
    '/company/notifications': 'notifications',
    '/company/promotions': 'ads',
    '/company/seat-maps': 'seat-maps',
    '/company/manifests-dashboard': 'manifests',
    '/company/passenger-manifests': 'manifests',
  };
  return raw || aliases[path] || 'overview';
}


function requestedSubviewFromRequest(req) {
  const path = String(req.path || '');
  const hotel = {
    '/company/hotel-properties': 'properties',
    '/company/room-types': 'room-types',
    '/company/rate-plans': 'rate-plans',
    '/company/room-units': 'room-units',
    '/company/room-calendar': 'room-calendar',
    '/company/housekeeping': 'housekeeping',
  };
  const manifest = {
    '/company/arrivals': 'arrivals',
    '/company/departures': 'departures',
    '/company/in-house-guests': 'in-house',
    '/company/manifests-dashboard': 'all',
    '/company/passenger-manifests': 'all',
  };
  return {
    hotelSubview: hotel[path] || 'properties',
    manifestSubview: manifest[path] || 'all',
    requestedPath: path,
  };
}

function allowedCompanyPage(page, serviceProfile = {}) {
  if (page === 'archive' || page === 'notifications') return page;
  const serviceDashboardPages = new Set(SERVICE_DASHBOARDS.map((service) => service.key));
  if (serviceDashboardPages.has(page)) return page;
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
    const requestedPage = requestedPageFromRequest(req);
    const requestedSubview = requestedSubviewFromRequest(req);
    const requestedManifestDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.date || '')) ? String(req.query.date) : '';
    const requestedHotelListingId = String(req.query?.listingId || '').trim();
    let baseDashboardData = await mongoDashboardService.roleDashboard('company', {
      companyId,
      activePage: requestedPage,
      hotelManifestDate: requestedManifestDate,
      hotelManifestListingId: requestedHotelListingId,
    });
    const archiveRows = requestedPage === 'archive'
      ? await archiveService.listForDashboard('company', { companyId })
      : [];
    const dashboardData = {
      ...baseDashboardData,
      archiveRows,
      dashboardFeatures: { services: companyServiceDashboards(baseDashboardData.serviceProfile), roles: ROLE_DASHBOARD_FEATURES },
      ...requestedSubview,
    };
    const companies = dashboardData.company ? [dashboardData.company] : [];
    const notificationRows = Array.isArray(dashboardData.notifications) ? dashboardData.notifications : [];
    const notificationCount = notificationRows.filter((row) => {
      const status = String(Array.isArray(row) ? (row[4] || row[5] || '') : row.status || '').toLowerCase();
      return !['read', 'dismissed', 'archived'].includes(status);
    }).length;
    res.render('dashboards/company/index', {
      seo: { title: `${dashboardData.serviceProfile?.dashboardLabel || 'Company'} dashboard | Classic Trip` },
      dashboardData,
      dashboardShell: buildDashboardShell('company', {
        user: req.session?.user,
        activePage: allowedCompanyPage(requestedPage, dashboardData.serviceProfile),
        companyId,
        company: dashboardData.company,
        serviceProfile: dashboardData.serviceProfile,
        companies,
        notifications: notificationRows,
        notificationCount,
      }),
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { index };
