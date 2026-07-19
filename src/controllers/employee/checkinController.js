const bookingService = require('../../services/booking/bookingService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyIdFor(req) {
  return resolveCompanyId(req);
}

function redirectWithScanResult(res, result) {
  const status = result?.ok ? 'success' : 'failed';
  const message = encodeURIComponent(result?.message || (result?.ok ? 'Ticket checked in' : 'Ticket could not be checked in'));
  return res.redirect(`/employee/dashboard?scan=${status}&message=${message}#employee-ops`);
}

async function checkIn(req, res, next) {
  try {
    const result = await bookingService.validateTicket(req.params.bookingRef, req.session?.user?.id || 'employee-form', companyIdFor(req));
    redirectWithScanResult(res, result);
  } catch (error) {
    next(error);
  }
}

async function noShow(req, res, next) {
  try {
    const result = await bookingService.markNoShow(req.params.bookingRef, req.session?.user?.id || 'employee-form', companyIdFor(req), req.body.note || '');
    redirectWithScanResult(res, result);
  } catch (error) {
    next(error);
  }
}

module.exports = { checkIn, noShow };
