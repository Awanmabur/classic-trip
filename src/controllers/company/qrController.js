const store = require('../../services/data/persistentStore');
const qrService = require('../../services/qr/qrService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyIdFor(req) {
  return resolveCompanyId(req, { allowOverride: true });
}

async function bookingQr(req, res, next) {
  try {
    const booking = store.searchBooking(req.params.bookingRef, companyIdFor(req));
    if (!booking) {
      const error = new Error('Booking not found for this company');
      error.status = 404;
      throw error;
    }
    const svg = await qrService.toSvg(qrService.valueForBooking(booking));
    if (!svg) {
      const error = new Error('QR generator is unavailable');
      error.status = 503;
      throw error;
    }
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'private, no-store');
    res.send(svg);
  } catch (error) {
    next(error);
  }
}

module.exports = { bookingQr };
