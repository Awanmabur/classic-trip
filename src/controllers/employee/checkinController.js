const bookingService = require('../../services/booking/bookingService');

function companyIdFor(req) {
  return req.session?.user?.companyId || 'company-01';
}

async function checkIn(req, res, next) {
  try {
    await bookingService.validateTicket(req.params.bookingRef, req.session?.user?.id || 'employee-form', companyIdFor(req));
    res.redirect('/employee/dashboard');
  } catch (error) {
    next(error);
  }
}

async function noShow(req, res, next) {
  try {
    await bookingService.markNoShow(req.params.bookingRef, req.session?.user?.id || 'employee-form', companyIdFor(req), req.body.note || '');
    res.redirect('/employee/dashboard');
  } catch (error) {
    next(error);
  }
}

module.exports = { checkIn, noShow };
