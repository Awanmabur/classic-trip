const operationsRepository = require('../../repositories/domain/operationsRepository');
const qrService = require('../../services/qr/qrService');
const { resolveCompanyId } = require('../../utils/companyScope');
async function bookingQr(req, res, next) {
  try {
    const companyId = resolveCompanyId(req, { allowOverride: true });
    const booking = await operationsRepository.bookings.findOne({ bookingRef: req.params.bookingRef, companyId });
    if (!booking) { const error = new Error('Booking not found for this company'); error.status = 404; throw error; }
    const svg = await qrService.toSvg(qrService.valueForBooking(booking));
    if (!svg) { const error = new Error('QR generator is unavailable'); error.status = 503; throw error; }
    res.set('Content-Type', 'image/svg+xml; charset=utf-8'); res.set('Cache-Control', 'private, no-store'); res.send(svg);
  } catch (error) { next(error); }
}
module.exports = { bookingQr };
