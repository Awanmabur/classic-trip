const reportService = require('../services/report/reportService');

function sendReport(res, report) {
  res.setHeader('Content-Type', report.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
  res.send(report.csv);
}

function admin(req, res) {
  sendReport(res, reportService.generateCsvReport('admin', req.params.type, { userId: req.session?.user?.id }));
}

function company(req, res) {
  sendReport(res, reportService.generateCsvReport('company', req.params.type, {
    userId: req.session?.user?.id,
    companyId: req.session?.user?.companyId || 'company-01',
  }));
}

function companyCustom(req, res) {
  sendReport(res, reportService.generateCsvReport('company', req.body.type || 'bookings', {
    userId: req.session?.user?.id,
    companyId: req.session?.user?.companyId || 'company-01',
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
    companyId: req.session?.user?.companyId || 'company-01',
  }));
}

function employeeCustom(req, res) {
  sendReport(res, reportService.generateCsvReport('employee', req.body.type || 'checkins', {
    userId: req.session?.user?.id,
    employeeId: req.session?.user?.id || 'user-employee-001',
    companyId: req.session?.user?.companyId || 'company-01',
  }));
}

module.exports = { admin, company, companyCustom, promoter, customer, employee, employeeCustom };
