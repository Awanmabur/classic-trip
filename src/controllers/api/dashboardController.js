const store = require('../../services/data/demoStore');
const actionService = require('../../services/dashboard/actionService');

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

function contextFromUser(user = {}) {
  return {
    companyId: user.companyId || 'company-01',
    promoterId: user.id || 'user-promoter-001',
    customerId: user.id || 'user-customer-001',
  };
}

function data(req, res) {
  const user = req.session?.user || {};
  const role = roleFromUser(user, req.params.role || req.query.role);
  res.json({ ok: true, role, data: store.dashboardData(role, contextFromUser(user)) });
}

async function action(req, res, next) {
  try {
    const user = req.session?.user || {};
    const role = roleFromUser(user, req.body.role);
    const actionName = req.params.action;
    const companyId = user.companyId || req.body.companyId || 'company-01';
    const actorId = user.id || 'dashboard-api';
    const body = req.body || {};
    const allowed = new Set([
      'createManualBooking', 'updateEmployeeInventory', 'sendDelayNotice', 'recordEmployeePayment',
      'requestEmployeeRefund', 'createEmployeeSupportNotice', 'createCustomerNote', 'createHandover',
      'updateEmployeeProfile', 'requestCompanyPayout', 'createCompanyNotice', 'updateCompanySettings'
    ]);
    if (!allowed.has(actionName)) {
      return res.status(400).json({ ok: false, message: 'This dashboard action is not wired to a safe endpoint yet.', action: actionName });
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
