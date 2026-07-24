const reportService = require('../services/report/reportService');
const { resolveCompanyId } = require('../utils/companyScope');
const { resolvePromoterId } = require('../utils/promoterScope');
const { resolveCustomerId } = require('../utils/customerScope');

function sendReport(res, report) {
  res.setHeader('Content-Type', report.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
  res.send(report.csv);
}

function handler(scope, typeFrom, contextFrom) {
  return async (req, res, next) => {
    try {
      const report = await reportService.generateCsvReport(scope, typeFrom(req), contextFrom(req));
      sendReport(res, report);
    } catch (error) { next(error); }
  };
}

const admin = handler('admin', (req) => req.params.type, (req) => ({ userId: req.session?.user?.id }));
const adminCustom = handler('admin', (req) => req.body.type || 'bookings', (req) => ({ userId: req.session?.user?.id }));
const company = handler('company', (req) => req.params.type, (req) => ({ userId: req.session?.user?.id, companyId: resolveCompanyId(req) }));
const companyCustom = handler('company', (req) => req.body.type || 'bookings', (req) => ({ userId: req.session?.user?.id, companyId: resolveCompanyId(req) }));
const promoter = handler('promoter', (req) => req.params.type, (req) => ({ userId: req.session?.user?.id, promoterId: resolvePromoterId(req) }));
const customer = handler('customer', (req) => req.params.type, (req) => ({ userId: req.session?.user?.id, customerId: resolveCustomerId(req) }));
const employee = handler('employee', (req) => req.params.type, (req) => ({ userId: req.session?.user?.id, employeeId: req.session?.user?.id, companyId: resolveCompanyId(req) }));
const employeeCustom = handler('employee', (req) => req.body.type || 'checkins', (req) => ({ userId: req.session?.user?.id, employeeId: req.session?.user?.id, companyId: resolveCompanyId(req) }));


function specializedHandler(scope, allowedTypes) {
  const allowed = new Set(allowedTypes);
  return handler(scope, (req) => {
    const type = String(req.params.type || req.body.type || 'bookings').replace(/\.csv$/i, '');
    if (!allowed.has(type)) {
      const error = new Error(`Report type "${type}" is not available for the ${scope} role`);
      error.status = 403;
      throw error;
    }
    return type;
  }, (req) => ({ userId: req.session?.user?.id }));
}

const support = specializedHandler('support', ['bookings', 'customers', 'support', 'refunds', 'reschedule', 'reschedules', 'correspondence', 'delivery-attempts', 'timeline']);
const finance = specializedHandler('finance', ['bookings', 'payments', 'refunds', 'finance-statements', 'finance-risk', 'settlements', 'ledger', 'payout-requests', 'payout-batches', 'reconciliation']);
const operations = specializedHandler('operations', ['bookings', 'listings', 'routes', 'route-stops', 'vehicles', 'schedules', 'inventory', 'carts', 'cart-checkouts', 'ticket-legs', 'ticket-scans', 'customers']);
const content = specializedHandler('content', ['listings', 'promotions', 'reviews']);

module.exports = { admin, adminCustom, company, companyCustom, promoter, customer, employee, employeeCustom, support, finance, operations, content };
