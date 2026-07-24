const actionService = require('../../services/dashboard/actionService');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
const {
  canonicalRole,
  canonicalPermission,
  permissionMatches,
  roleHasPermission,
} = require('../../config/accessControl');
const { effectivePermissionsFresh } = require('../../middlewares/permissions');

const ADMIN_DATA_ROLES = Object.freeze({
  super_admin: 'admin',
  admin: 'admin',
  support_admin: 'support',
  finance_admin: 'finance',
  operations_admin: 'operations',
  content_admin: 'content',
});

function roleFromUser(user = {}, requested = '') {
  const userRole = canonicalRole(user.role);
  const requestedRole = String(requested || '').toLowerCase();
  if (requestedRole) {
    if (['super_admin', 'admin'].includes(userRole) && ['admin', 'support', 'finance', 'operations', 'content', 'company', 'employee', 'driver', 'customer', 'promoter'].includes(requestedRole)) return requestedRole;
    if (requestedRole === 'company' && userRole === 'company_admin') return 'company';
    if (requestedRole === 'employee' && ['company_employee', 'company_admin'].includes(userRole)) return 'employee';
    if (requestedRole === 'driver' && userRole === 'driver') return 'driver';
    if (requestedRole === 'customer' && userRole === 'customer') return 'customer';
    if (requestedRole === 'promoter' && userRole === 'promoter') return 'promoter';
  }
  if (ADMIN_DATA_ROLES[userRole]) return ADMIN_DATA_ROLES[userRole];
  if (userRole === 'company_admin') return 'company';
  if (userRole === 'company_employee') return 'employee';
  if (userRole === 'driver') return 'driver';
  if (userRole === 'promoter') return 'promoter';
  return 'customer';
}

function contextFromUser(user = {}, role = '') {
  if (['company', 'employee', 'driver'].includes(role) && !user.companyId) {
    const error = new Error('Your account is not linked to a company yet. Please contact support or complete partner onboarding.');
    error.status = 403;
    throw error;
  }
  if (['promoter', 'customer'].includes(role) && !user.id) {
    const error = new Error('Your session could not be verified. Please log in again.');
    error.status = 403;
    throw error;
  }
  return {
    companyId: user.companyId || '',
    promoterId: user.id || '',
    customerId: user.id || '',
    driverId: user.id || '',
  };
}

const ACTION_RULES = Object.freeze({
  createManualBooking: 'booking.create_manual',
  updateEmployeeInventory: 'inventory.update',
  sendDelayNotice: 'schedule.delay_notice',
  recordEmployeePayment: 'payment.record',
  requestEmployeeRefund: 'refund.request',
  createEmployeeSupportNotice: 'support.note',
  createCustomerNote: 'customer.note',
  createHandover: 'handover.create',
  updateEmployeeProfile: 'profile.update',
  requestCompanyPayout: 'payouts.request',
  createCompanyNotice: 'support.manage',
  updateCompanySettings: 'company.settings.update',
});

async function assertActionAllowed(user = {}, actionName) {
  const required = canonicalPermission(ACTION_RULES[actionName]);
  if (!required) {
    const error = new Error('Unsupported dashboard action.');
    error.status = 400;
    throw error;
  }
  const role = canonicalRole(user.role);
  if (['super_admin', 'admin'].includes(role)) return true;
  if (role === 'company_admin') return true;
  if (role !== 'company_employee') {
    const error = new Error('This dashboard action is not available for your role.');
    error.status = 403;
    throw error;
  }
  const permissions = await effectivePermissionsFresh(user);
  if (permissions.some((granted) => permissionMatches(granted, required)) || roleHasPermission(role, required)) return true;
  const error = new Error('Your assigned employee permissions do not allow this dashboard action.');
  error.status = 403;
  error.code = 'permission_denied';
  throw error;
}

async function data(req, res, next) {
  try {
    const user = req.session?.user || {};
    const role = roleFromUser(user, req.params.role || req.query.role);
    const data = await mongoDashboardService.roleDashboard(role, contextFromUser(user, role));
    res.json({ ok: true, role, data });
  } catch (error) {
    next(error);
  }
}

async function action(req, res, next) {
  try {
    const user = req.session?.user || {};
    const actionName = req.params.action;
    await assertActionAllowed(user, actionName);
    const userRole = canonicalRole(user.role);
    const companyIdOverride = ['super_admin', 'admin'].includes(userRole) ? req.body.companyId : '';
    const companyId = companyIdOverride || user.companyId || '';
    if (!companyId) {
      const error = new Error('A company scope is required for this dashboard action.');
      error.status = 403;
      throw error;
    }
    const actorId = user.id || 'dashboard-api';
    const result = await actionService[actionName](companyId, req.body || {}, actorId);
    return res.json({ ok: true, action: actionName, result });
  } catch (error) {
    next(error);
  }
}

module.exports = { data, action, roleFromUser, assertActionAllowed, ACTION_RULES };
