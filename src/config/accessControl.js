const ROLE_ALIASES = Object.freeze({
  partner: 'company_admin',
  employee: 'company_employee',
  staff: 'company_employee',
  support_agent: 'support_admin',
  finance_agent: 'finance_admin',
  operations_agent: 'operations_admin',
});

const ROLE_PERMISSIONS = Object.freeze({
  super_admin: ['*'],
  admin: [
    'platform.view', 'platform.manage', 'content.manage', 'operations.manage',
    'support.manage', 'finance.manage', 'companies.manage', 'bookings.manage',
    'reports.view', 'settings.manage',
  ],
  content_admin: ['platform.view', 'content.manage', 'listings.manage', 'promotions.manage', 'reports.view'],
  support_admin: ['platform.view', 'support.manage', 'bookings.view', 'customers.view', 'refunds.request', 'reports.view'],
  finance_admin: ['platform.view', 'finance.manage', 'payments.manage', 'refunds.manage', 'payouts.manage', 'reports.view'],
  operations_admin: ['platform.view', 'operations.manage', 'bookings.manage', 'inventory.manage', 'checkin.manage', 'reports.view'],
  company_admin: ['company.*', 'booking.*', 'inventory.*', 'schedule.*', 'payment.*', 'refund.*', 'support.*', 'customer.*', 'handover.*', 'reports.*', 'profile.*', 'manifest.*', 'checkin.*'],
  company_employee: [],
  driver: ['driver.dashboard', 'manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create'],
  promoter: ['promoter.dashboard', 'referrals.manage', 'offline_sales.manage', 'payouts.request'],
  customer: ['customer.dashboard', 'booking.create', 'booking.view_own', 'support.create'],
});

const EMPLOYEE_PERMISSION_ALIASES = Object.freeze({
  view_bookings: 'booking.view',
  create_bookings: 'booking.create_manual',
  create_booking: 'booking.create_manual',
  scan_tickets: 'checkin.scan',
  scanner: 'checkin.scan',
  check_in: 'checkin.manage',
  checkin: 'checkin.manage',
  hotel_checkin: 'checkin.manage',
  mark_no_show: 'checkin.no_show',
  view_manifest: 'manifest.view',
  manifest: 'manifest.view',
  driver_manifest: 'manifest.view',
  manage_inventory: 'inventory.update',
  update_inventory: 'inventory.update',
  inventory_manager: 'inventory.update',
  housekeeping: 'inventory.update',
  manage_schedule: 'schedule.update',
  route_manager: 'schedule.update',
  send_delay_notice: 'schedule.delay_notice',
  record_payments: 'payment.record',
  record_payment: 'payment.record',
  finance: 'payment.record',
  request_refunds: 'refund.request',
  request_refund: 'refund.request',
  manage_support: 'support.manage',
  support: 'support.manage',
  support_notes: 'support.note',
  customer_notes: 'customer.note',
  create_handover: 'handover.create',
  view_reports: 'reports.view',
  report_viewer: 'reports.view',
  manage_profile: 'profile.update',
  trip_status: 'trip.status.update',
  driver_checkin: 'checkin.assist',
  assist_checkin: 'checkin.assist',
  report_incident: 'incident.create',
  incident_reporter: 'incident.create',
});

const REQUIRED_DRIVER_PERMISSIONS = Object.freeze([
  'manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create',
]);

const ALLOWED_EMPLOYEE_PERMISSIONS = Object.freeze([
  'booking.view', 'booking.create_manual', 'checkin.scan', 'checkin.manage', 'checkin.no_show',
  'manifest.view', 'inventory.update', 'schedule.update', 'schedule.delay_notice',
  'payment.record', 'refund.request', 'support.manage', 'support.note', 'customer.note',
  'handover.create', 'reports.view', 'profile.update',
  'checkin.assist', 'trip.status.update', 'incident.create',
]);

const EMPLOYEE_ROLE_DEFAULTS = Object.freeze({
  scanner: ['booking.view', 'checkin.scan', 'checkin.manage', 'checkin.no_show', 'manifest.view'],
  check_in_agent: ['booking.view', 'checkin.scan', 'checkin.manage', 'checkin.no_show', 'manifest.view'],
  front_desk: ['booking.view', 'booking.create_manual', 'checkin.manage', 'checkin.no_show', 'manifest.view', 'customer.note', 'profile.update'],
  housekeeping: ['inventory.update', 'handover.create', 'profile.update'],
  route_manager: ['booking.view', 'manifest.view', 'inventory.update', 'schedule.update', 'schedule.delay_notice', 'reports.view'],
  inventory_manager: ['booking.view', 'inventory.update', 'schedule.update', 'reports.view'],
  hotel_manager: ['booking.view', 'booking.create_manual', 'checkin.manage', 'checkin.no_show', 'manifest.view', 'inventory.update', 'schedule.update', 'support.manage', 'reports.view', 'profile.update'],
  finance: ['booking.view', 'payment.record', 'refund.request', 'reports.view'],
  support: ['booking.view', 'support.manage', 'support.note', 'customer.note', 'refund.request', 'reports.view'],
  report_viewer: ['reports.view'],
  driver: ['manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create'],
});

function canonicalRole(role = '') {
  const key = String(role || '').trim().toLowerCase();
  return ROLE_ALIASES[key] || key;
}

function canonicalPermission(permission = '') {
  const key = String(permission || '').trim().toLowerCase();
  return EMPLOYEE_PERMISSION_ALIASES[key] || key;
}

function permissionMatches(granted = '', required = '') {
  if (granted === '*' || granted === required) return true;
  if (granted.endsWith('.*')) return required.startsWith(granted.slice(0, -1));
  return false;
}

function roleHasPermission(role, required) {
  const canonical = canonicalRole(role);
  return (ROLE_PERMISSIONS[canonical] || []).some((permission) => permissionMatches(permission, required));
}

function normalizePermissions(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [values])
    .map(canonicalPermission)
    .filter(Boolean)));
}

function employeePermissions(roleTitle = '', requested = []) {
  const roleKey = String(roleTitle || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const normalized = normalizePermissions(requested);
  const allowed = new Set(ALLOWED_EMPLOYEE_PERMISSIONS);
  const selected = normalized.filter((permission) => allowed.has(permission));
  return selected.length ? selected : [...(EMPLOYEE_ROLE_DEFAULTS[roleKey] || ['profile.update'])];
}

module.exports = {
  ROLE_ALIASES,
  ROLE_PERMISSIONS,
  EMPLOYEE_PERMISSION_ALIASES,
  ALLOWED_EMPLOYEE_PERMISSIONS,
  EMPLOYEE_ROLE_DEFAULTS,
  REQUIRED_DRIVER_PERMISSIONS,
  canonicalRole,
  canonicalPermission,
  permissionMatches,
  roleHasPermission,
  normalizePermissions,
  employeePermissions,
};
