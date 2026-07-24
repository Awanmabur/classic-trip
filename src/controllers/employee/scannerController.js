const bookingService = require('../../services/booking/bookingService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyIdFor(req) {
  return resolveCompanyId(req, { allowOverride: true });
}

function actorContext(req) {
  const user = req.session?.user || {};
  if (!user.id) { const error = new Error('Authenticated employee identity is required'); error.status = 401; throw error; }
  return {
    userId: user.id,
    actorRole: user.role || 'company_employee',
    companyId: companyIdFor(req),
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  };
}

function scannerValue(req) {
  return String(req.body.qrToken || req.body.ticketNumber || req.body.qrCodeValue || req.body.bookingRef || req.body.guestLookupCode || req.body.paymentRef || req.body.query || req.body.value || '').trim();
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
    const ctx = actorContext(req);
    const value = requireScannerValue(req, res);
    if (!value) return;
    const result = await bookingService.lookupTicket(value, ctx.companyId, { ...ctx, source: req.body.source || '', location: req.body.location || '', scheduleId: req.body.scheduleId || '' });
    res.status(result.booking ? 200 : 404).json(result);
  } catch (error) {
    next(error);
  }
}

async function validate(req, res, next) {
  try {
    const ctx = actorContext(req);
    const value = requireScannerValue(req, res);
    if (!value) return;
    const result = await bookingService.validateTicket(value, ctx.userId, ctx.companyId, { ...ctx, note: req.body.note || '', source: req.body.source || '', location: req.body.location || '', scheduleId: req.body.scheduleId || '' });
    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    next(error);
  }
}

async function noShow(req, res, next) {
  try {
    const ctx = actorContext(req);
    const value = requireScannerValue(req, res);
    if (!value) return;
    const result = await bookingService.markNoShow(value, ctx.userId, ctx.companyId, req.body.note || '', { ...ctx, source: req.body.source || '', location: req.body.location || '', scheduleId: req.body.scheduleId || '' });
    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = { lookup, validate, noShow };
