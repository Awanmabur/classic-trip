const bookingService = require('../../services/booking/bookingService');

async function checkIn(req, res, next) {
  try {
    const bookingRef = req.params.bookingRef || req.body.bookingRef || req.body.qrCodeValue;
    await bookingService.validateTicket(bookingRef, req.session?.user?.id || 'company-admin');
    res.redirect('/company/checkins');
  } catch (error) {
    next(error);
  }
}

module.exports = { checkIn };
