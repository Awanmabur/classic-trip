const supportRepository = require('../../repositories/domain/supportRepository');
const { nextId } = require('../../services/data/idService');
const companyService = require('../../services/company/companyService');
const bookingService = require('../../services/booking/bookingService');
const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');
const { resolveCompanyId } = require('../../utils/companyScope');
const archiveService = require('../../services/archive/archiveService');

function scopedServices(serviceProfile = {}) {
  const type = serviceProfile.primaryServiceType || 'bus';
  return SERVICE_DASHBOARDS.filter((service) => service.serviceType === type);
}

function companyId(req) {
  return resolveCompanyId(req);
}

function actorId(req) {
  return req.session?.user?.id || 'driver-system';
}

async function driverDashboard(req, res, next) {
  try {
    const activePage = String(req.params?.page || 'overview').trim().toLowerCase();
    const context = { companyId: companyId(req), employeeId: actorId(req), activePage };
    const dashboardData = await mongoDashboardService.roleDashboard('driver', context);
    const archiveRows = activePage === 'archive'
      ? await archiveService.listForDashboard('driver', { companyId: context.companyId })
      : [];
    const notificationRows = Array.isArray(dashboardData.notifications) ? dashboardData.notifications : [];
    const notificationCount = notificationRows.filter((row) => {
      const status = String(Array.isArray(row) ? (row[4] || row[5] || '') : row.status || '').toLowerCase();
      return !['read', 'dismissed', 'archived'].includes(status);
    }).length;
    const companies = dashboardData.company ? [dashboardData.company] : [];
    res.render('dashboards/driver/index', {
      seo: { title: 'Driver dashboard | Classic Trip' },
      dashboardData: { ...dashboardData, archiveRows, notifications: notificationRows, dashboardFeatures: { services: scopedServices(dashboardData.serviceProfile), roles: ROLE_DASHBOARD_FEATURES } },
      dashboardMode: 'driver',
      dashboardShell: buildDashboardShell('driver', {
        user: req.session?.user,
        companyId: companyId(req),
        companies,
        notifications: notificationRows,
        notificationCount,
        activePage,
        company: dashboardData.company,
        serviceProfile: dashboardData.serviceProfile,
      }),
    });
  } catch (error) {
    next(error);
  }
}

async function updateTripStatus(req, res, next) {
  try {
    await companyService.updateTripStatus(companyId(req), req.params.scheduleId, req.body, actorId(req), req.session?.user?.role);
    res.redirect('/driver/dashboard#driver-ops');
  } catch (error) {
    next(error);
  }
}

async function createIncident(req, res, next) {
  try {
    await companyService.createDriverIncident(companyId(req), req.body, actorId(req), req.session?.user?.role);
    res.redirect('/driver/dashboard#driver-incidents');
  } catch (error) {
    next(error);
  }
}

async function bookingAssist(req, res, next) {
  try {
    const action = String(req.body.action || '').toLowerCase();
    if (action === 'check_in') {
      await bookingService.validateTicket(req.params.bookingRef, actorId(req), companyId(req), {
        actorRole: req.session?.user?.role || 'company_employee',
        source: 'driver_assist',
        note: req.body.note || '',
      });
    } else if (action === 'no_show') {
      await bookingService.markNoShow(req.params.bookingRef, actorId(req), companyId(req), req.body.note || '');
    } else {
      const ticket = {
        id: await nextId('support'),
        companyId: companyId(req),
        bookingRef: req.params.bookingRef,
        ownerType: 'company',
        ownerId: companyId(req),
        subject: 'Driver assistance note',
        category: 'Driver assistance',
        message: String(req.body.note || 'Driver assistance note').trim().slice(0, 3000),
        priority: 'normal',
        status: 'open',
        createdBy: actorId(req),
        createdAt: new Date().toISOString(),
      };
      await supportRepository.tickets.save(ticket, { id: ticket.id });
    }
    res.redirect(`/driver/tickets/${encodeURIComponent(req.params.bookingRef)}`);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  driverDashboard,
  updateTripStatus,
  createIncident,
  bookingAssist,
};
