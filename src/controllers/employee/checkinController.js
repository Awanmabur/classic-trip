const bookingService = require('../../services/booking/bookingService');
const hotelService = require('../../services/hotel/hotelService');
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

async function hotelCheckIn(req, res, next) {
  try {
    await hotelService.markStay(companyIdFor(req), req.params.bookingRef, 'checked_in', req.session?.user?.id || 'employee-form');
    res.redirect('/employee/dashboard/in-house-guests');
  } catch (error) {
    next(error);
  }
}

async function hotelCheckOut(req, res, next) {
  try {
    await hotelService.markStay(companyIdFor(req), req.params.bookingRef, 'checked_out', req.session?.user?.id || 'employee-form', { overrideReason: req.body.overrideReason });
    res.redirect('/employee/dashboard/departures');
  } catch (error) {
    next(error);
  }
}

async function hotelNoShow(req, res, next) {
  try {
    await hotelService.markNoShow(companyIdFor(req), req.params.bookingRef, req.session?.user?.id || 'employee-form', {
      reason: req.body.reason || req.body.note,
      overrideReason: req.body.overrideReason,
    });
    res.redirect('/employee/dashboard/arrivals');
  } catch (error) {
    next(error);
  }
}

module.exports = { checkIn, noShow, hotelCheckIn, hotelCheckOut, hotelNoShow };
