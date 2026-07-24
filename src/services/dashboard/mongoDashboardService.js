const repositories = require('../../repositories');
const snapshotService = require('./dashboardSnapshotService');
const { createDashboardProjection } = require('./dashboardProjectionEngine');

function cleanLimit(value, fallback = 50, max = 500) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

async function listEntity(entity, filter = {}, options = {}) {
  const repo = repositories.readyRepository(entity);
  return repo.list(filter, { sort: options.sort || { createdAt: -1 }, limit: cleanLimit(options.limit, 100), skip: Number(options.skip || 0) });
}

async function countEntity(entity, filter = {}) {
  const repo = repositories.readyRepository(entity);
  return repo.count(filter);
}

const ROLE_DATA_KEYS = Object.freeze({
  support: [
    'bookings', 'customers', 'refunds', 'support', 'correspondence', 'deliveryAttempts',
    'timeline', 'reschedules', 'notifications', 'ticketLegs', 'ticketScans', 'recentActivity',
    'recentBookings', 'overviewStats',
  ],
  finance: [
    'bookings', 'payments', 'refunds', 'financeAudit', 'financeRisk', 'financeStatements',
    'ledger', 'settlements', 'reconciliation', 'paymentIntents', 'receiptInvoices', 'taxFees',
    'payoutRequests', 'payoutBatches', 'partners', 'promoters', 'notifications', 'recentActivity',
    'overviewStats',
  ],
  operations: [
    'bookings', 'listings', 'routes', 'schedules', 'vehicles', 'routeInventory', 'stayInventory',
    'reviewInventory', 'carts', 'cartCheckouts', 'ticketLegs', 'ticketScans', 'customers',
    'partners', 'notifications', 'recentActivity', 'recentBookings', 'overviewStats', 'systemHealth',
  ],
  content: [
    'listings', 'ads', 'partners', 'promoters', 'reviewInventory', 'notifications', 'recentActivity',
    'overviewStats',
  ],
});


const EMPLOYEE_DATA_PERMISSIONS = Object.freeze({
  bookings: ['booking.view', 'booking.create_manual', 'checkin.scan', 'checkin.manage', 'checkin.no_show', 'payment.record', 'refund.request', 'customer.note', 'support.manage', 'support.note'],
  checkins: ['checkin.scan', 'checkin.manage', 'checkin.no_show', 'manifest.view'],
  schedules: ['schedule.update', 'schedule.delay_notice', 'manifest.view', 'inventory.update'],
  driverOps: ['schedule.update', 'schedule.delay_notice', 'manifest.view'],
  driverIncidents: ['manifest.view'],
  tripStatusUpdates: ['schedule.update', 'schedule.delay_notice', 'manifest.view'],
  routes: ['schedule.update', 'schedule.delay_notice', 'manifest.view', 'inventory.update'],
  vehicles: ['schedule.update', 'manifest.view', 'inventory.update'],
  inventory: ['inventory.update', 'manifest.view'],
  customers: ['customer.note', 'booking.view', 'support.manage', 'support.note'],
  payments: ['payment.record'],
  refunds: ['refund.request'],
  tasks: ['support.manage', 'support.note'],
  support: ['support.manage', 'support.note'],
  handovers: ['handover.create'],
  reports: ['reports.view'],
});

function hasAnyPermission(granted, required = []) {
  return granted.has('*') || required.some((permission) => granted.has(permission));
}

function restrictEmployeeStats(stats = {}, granted) {
  const visible = { shiftEnds: stats.shiftEnds };
  if (hasAnyPermission(granted, ['checkin.scan', 'checkin.manage', 'checkin.no_show', 'manifest.view'])) visible.checkedIn = stats.checkedIn;
  if (hasAnyPermission(granted, ['booking.view', 'booking.create_manual'])) visible.manualBookings = stats.manualBookings;
  if (hasAnyPermission(granted, ['support.manage', 'support.note'])) visible.openTasks = stats.openTasks;
  if (hasAnyPermission(granted, ['payment.record', 'reports.view'])) {
    visible.deskSales = stats.deskSales;
    visible.paymentsRecorded = stats.paymentsRecorded;
  }
  if (hasAnyPermission(granted, ['customer.note', 'support.manage', 'support.note'])) visible.notesAdded = stats.notesAdded;
  if (hasAnyPermission(granted, ['refund.request', 'reports.view'])) visible.refundRequestsHandled = stats.refundRequestsHandled;
  return Object.fromEntries(Object.entries(visible).filter(([, value]) => value !== undefined));
}

function restrictEmployeeOptions(options = {}, granted) {
  const restricted = {};
  if (hasAnyPermission(granted, ['booking.create_manual', 'schedule.update', 'inventory.update'])) restricted.listings = options.listings || [];
  if (hasAnyPermission(granted, ['booking.view', 'booking.create_manual', 'checkin.scan', 'checkin.manage', 'checkin.no_show', 'schedule.update', 'schedule.delay_notice', 'manifest.view', 'inventory.update'])) restricted.schedules = options.schedules || [];
  if (hasAnyPermission(granted, ['schedule.update', 'manifest.view', 'inventory.update'])) restricted.vehicles = options.vehicles || [];
  if (hasAnyPermission(granted, ['booking.view', 'booking.create_manual', 'checkin.manage', 'inventory.update'])) restricted.rooms = options.rooms || [];
  return restricted;
}

function restrictEmployeeDashboard(data = {}, permissions = []) {
  const granted = new Set(permissions || []);
  const restricted = {};
  for (const key of ['mode', 'company', 'profile', 'serviceProfile']) {
    if (data[key] !== undefined) restricted[key] = data[key];
  }
  restricted.stats = restrictEmployeeStats(data.stats || {}, granted);
  restricted.options = restrictEmployeeOptions(data.options || {}, granted);
  for (const [key, required] of Object.entries(EMPLOYEE_DATA_PERMISSIONS)) {
    if (hasAnyPermission(granted, required) && data[key] !== undefined) restricted[key] = data[key];
  }
  return restricted;
}

const ROLE_STAT_LABELS = Object.freeze({
  support: new Set(['Customers', 'Total bookings', 'Cancelled / refunded', 'Support cases']),
  finance: new Set(['Total bookings', 'Cancelled / refunded', 'Gross revenue', 'Platform commission', 'Partner earnings', 'Promoter commission', 'Pending settlements', 'Wallet withdrawals']),
  operations: new Set(['Partner companies', 'Listings / routes / trips', 'Total bookings', 'Cancelled / refunded', 'Guest / referred bookings']),
  content: new Set(['Total users', 'Customers', 'Promoters', 'Partner companies', 'Listings / routes / trips']),
});

function restrictRoleDashboard(role, data = {}) {
  const keys = ROLE_DATA_KEYS[role];
  if (!keys) return data;
  const allowed = new Set(keys);
  const restricted = Object.fromEntries(Object.entries(data).filter(([key]) => allowed.has(key)));
  if (Array.isArray(restricted.overviewStats)) {
    restricted.overviewStats = restricted.overviewStats.filter((item) => ROLE_STAT_LABELS[role]?.has(item.label));
  }
  return restricted;
}

async function roleDashboard(role, context = {}) {
  const dataRole = ['support', 'finance', 'operations', 'content'].includes(role) ? 'admin' : role;
  const snapshot = await snapshotService.load(dataRole, context);
  const projection = createDashboardProjection(snapshot);
  const data = projection.dashboardData(dataRole, context);
  if (role === 'employee') return restrictEmployeeDashboard(data, context.permissions || []);
  return restrictRoleDashboard(role, data);
}

module.exports = {
  listEntity,
  countEntity,
  roleDashboard,
  restrictRoleDashboard,
  restrictEmployeeDashboard,
  ROLE_DATA_KEYS,
  EMPLOYEE_DATA_PERMISSIONS,
};
