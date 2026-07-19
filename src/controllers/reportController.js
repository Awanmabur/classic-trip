const reportService = require('../services/report/reportService');
const { resolveCompanyId } = require('../utils/companyScope');

function sendReport(res, report) {
  res.setHeader('Content-Type', report.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
  res.send(report.csv);
}

function admin(req, res) {
  sendReport(res, reportService.generateCsvReport('admin', req.params.type, { userId: req.session?.user?.id }));
}

function adminCustom(req, res) {
  sendReport(res, reportService.generateCsvReport('admin', req.body.type || 'bookings', { userId: req.session?.user?.id }));
}

function company(req, res) {
  sendReport(res, reportService.generateCsvReport('company', req.params.type, {
    userId: req.session?.user?.id,
    companyId: resolveCompanyId(req),
  }));
}

function companyCustom(req, res) {
  sendReport(res, reportService.generateCsvReport('company', req.body.type || 'bookings', {
    userId: req.session?.user?.id,
    companyId: resolveCompanyId(req),
  }));
}

function promoter(req, res) {
  sendReport(res, reportService.generateCsvReport('promoter', req.params.type, {
    userId: req.session?.user?.id,
    promoterId: req.session?.user?.id || 'user-promoter-001',
  }));
}

function customer(req, res) {
  sendReport(res, reportService.generateCsvReport('customer', req.params.type, {
    userId: req.session?.user?.id,
    customerId: req.session?.user?.id || 'user-customer-001',
  }));
}

function employee(req, res) {
  sendReport(res, reportService.generateCsvReport('employee', req.params.type, {
    userId: req.session?.user?.id,
    employeeId: req.session?.user?.id || 'user-employee-001',
    companyId: resolveCompanyId(req),
  }));
}

function employeeCustom(req, res) {
  sendReport(res, reportService.generateCsvReport('employee', req.body.type || 'checkins', {
    userId: req.session?.user?.id,
    employeeId: req.session?.user?.id || 'user-employee-001',
    companyId: resolveCompanyId(req),
  }));
}

module.exports = { admin, adminCustom, company, companyCustom, promoter, customer, employee, employeeCustom };
