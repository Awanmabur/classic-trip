const store = require('../../services/data/persistentStore');
const actionService = require('../../services/dashboard/actionService');
const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');

function roleFromUser(user = {}, requested = '') {
  const requestedRole = String(requested || '').toLowerCase();
  if (requestedRole) {
    if (['super_admin', 'admin'].includes(user.role) && ['admin', 'company', 'employee', 'customer', 'promoter'].includes(requestedRole)) return requestedRole;
    if (requestedRole === 'company' && ['company_admin', 'partner'].includes(user.role)) return 'company';
    if (requestedRole === 'employee' && ['company_employee', 'company_admin', 'partner'].includes(user.role)) return 'employee';
    if (requestedRole === 'customer' && user.role === 'customer') return 'customer';
    if (requestedRole === 'promoter' && user.role === 'promoter') return 'promoter';
  }
  if (['super_admin', 'admin'].includes(user.role)) return 'admin';
  if (['company_admin', 'partner'].includes(user.role)) return 'company';
  if (user.role === 'company_employee') return 'employee';
  if (user.role === 'promoter') return 'promoter';
  return 'customer';
}

function contextFromUser(user = {}, role = '') {
  if (['company', 'employee'].includes(role) && !user.companyId) {
    const error = new Error('Your account is not linked to a company yet. Please contact support or complete partner onboarding.');
    error.status = 403;
    throw error;
  }
  return {
    companyId: user.companyId || '',
    promoterId: user.id || 'user-promoter-001',
    customerId: user.id || 'user-customer-001',
  };
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
    const role = roleFromUser(user, req.body.role);
    const actionName = req.params.action;
    const companyIdOverride = ['super_admin', 'admin'].includes(user.role) ? req.body.companyId : '';
    let companyId = companyIdOverride || user.companyId || '';
    if (['company', 'employee'].includes(role) && !companyId) {
      const error = new Error('Your account is not linked to a company yet. Please contact support or complete partner onboarding.');
      error.status = 403;
      throw error;
    }
    const actorId = user.id || 'dashboard-api';
    const body = req.body || {};
    const allowed = new Set([
      'createManualBooking', 'updateEmployeeInventory', 'sendDelayNotice', 'recordEmployeePayment',
      'requestEmployeeRefund', 'createEmployeeSupportNotice', 'createCustomerNote', 'createHandover',
      'updateEmployeeProfile', 'requestCompanyPayout', 'createCompanyNotice', 'updateCompanySettings'
    ]);
    if (!allowed.has(actionName)) {
      return res.status(400).json({ ok: false, message: 'Unsupported dashboard action.', action: actionName });
    }
    if (!['admin', 'company', 'employee'].includes(role)) {
      return res.status(403).json({ ok: false, message: 'This dashboard action is not available for your role.' });
    }
    const result = await actionService[actionName](companyId, body, actorId);
    return res.json({ ok: true, action: actionName, result });
  } catch (error) {
    next(error);
  }
}

module.exports = { data, action };
