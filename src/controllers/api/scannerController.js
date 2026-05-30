const bookingService = require('../../services/booking/bookingService');
const { scopedCompanyId } = require('../../middlewares/apiAuth');

function scannerContext(req) {
  const user = req.session?.user || {};
  return {
    userId: user.id || 'scanner-api',
    actorRole: user.role || 'api',
    companyId: scopedCompanyId(req),
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  };
}

function scannerValue(req) {
  return String(req.body.qrCodeValue || req.body.bookingRef || req.body.guestLookupCode || req.body.paymentRef || req.body.query || req.body.value || '').trim();
}

function requireScannerValue(req, res) {
  const value = scannerValue(req);
  if (!value) {
    res.status(422).json({ ok: false, result: 'missing_lookup_value', message: 'Enter or scan a booking reference, QR value, guest lookup code, payment reference, email, phone, or seat/room value.' });
    return '';
  }
  return value;
}

async function lookup(req, res, next) {
  try {
    const ctx = scannerContext(req);
    const value = requireScannerValue(req, res);
    if (!value) return;
    const result = await bookingService.lookupTicket(value, ctx.companyId, ctx);
    res.status(result.booking ? 200 : 404).json(result);
  } catch (error) {
    next(error);
  }
}

async function validate(req, res, next) {
  try {
    const ctx = scannerContext(req);
    const value = requireScannerValue(req, res);
    if (!value) return;
    const result = await bookingService.validateTicket(value, ctx.userId, ctx.companyId, { ...ctx, note: req.body.note || '' });
    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    next(error);
  }
}

async function noShow(req, res, next) {
  try {
    const ctx = scannerContext(req);
    const value = requireScannerValue(req, res);
    if (!value) return;
    const result = await bookingService.markNoShow(value, ctx.userId, ctx.companyId, req.body.note || '', ctx);
    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = { lookup, validate, noShow };
