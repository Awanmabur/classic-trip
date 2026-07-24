const supportRepository = require('../../repositories/domain/supportRepository');
const { nextId } = require('../../services/data/idService');
const companyService = require('../../services/company/companyService');
const bookingService = require('../../services/booking/bookingService');
const { buildDashboardShell } = require('../../services/dashboard/shellConfig');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const notificationService = require('../../services/notification/notificationService');
const { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES } = require('../../config/dashboardFeatures');
const { resolveCompanyId } = require('../../utils/companyScope');

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
    const context = { companyId: companyId(req), employeeId: actorId(req) };
    const dashboardData = await mongoDashboardService.roleDashboard('driver', context);
    const companyDashboardData = await mongoDashboardService.roleDashboard('company', { companyId: companyId(req) });
    const [notificationRows, notificationCount, companies] = await Promise.all([notificationService.dashboardRowsLive('driver', context), notificationService.unreadCountLive('driver', context), mongoDashboardService.listEntity('companies', {}, { limit: 250 })]);
    res.render('dashboards/driver/index', {
      seo: { title: 'Driver dashboard | Classic Trip' },
      dashboardData: { ...dashboardData, notifications: notificationRows, dashboardFeatures: { services: scopedServices(companyDashboardData.serviceProfile), roles: ROLE_DASHBOARD_FEATURES } },
      dashboardMode: 'driver',
      dashboardShell: buildDashboardShell('driver', {
        user: req.session?.user,
        companyId: companyId(req),
        companies,
        notifications: notificationRows,
        notificationCount,
        activePage: req.params?.page || 'overview',
        company: companyDashboardData.company,
        serviceProfile: companyDashboardData.serviceProfile,
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
