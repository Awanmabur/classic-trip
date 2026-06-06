const bookingService = require('../../services/booking/bookingService');

function companyIdFor(req) {
  const user = req.session?.user || {};
  if (user.role === 'super_admin') return req.body.companyId || user.companyId || 'company-01';
  return user.companyId || 'company-01';
}

function actorContext(req) {
  const user = req.session?.user || {};
  return {
    userId: user.id || 'company-admin',
    actorRole: user.role || 'company_admin',
    actorName: user.fullName || '',
    actorEmail: user.email || '',
    companyId: companyIdFor(req),
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  };
}

function scannerValue(req) {
  return String(req.params.bookingRef || req.body.qrCodeValue || req.body.bookingRef || req.body.guestLookupCode || req.body.paymentRef || req.body.query || req.body.value || '').trim();
}

function wantsJson(req) {
  return req.xhr || req.get('accept')?.includes('application/json') || req.is('application/json');
}

function redirectWithScanResult(res, result) {
  const status = result?.ok ? 'success' : 'failed';
  const message = encodeURIComponent(result?.message || (result?.ok ? 'Ticket checked in' : 'Ticket could not be checked in'));
  return res.redirect(`/company/checkins?scan=${status}&message=${message}#checkins`);
}

function requireScannerValue(req, res) {
  const value = scannerValue(req);
  if (value) return value;
  const result = { ok: false, result: 'missing_lookup_value', message: 'Enter or scan a booking reference, QR value, lookup code, payment reference, email, phone, or seat/room value.' };
  if (wantsJson(req)) {
    res.status(422).json(result);
  } else {
    redirectWithScanResult(res, result);
  }
  return '';
}

async function lookup(req, res, next) {
  try {
    const ctx = actorContext(req);
    const value = requireScannerValue(req, res);
    if (!value) return;
    const result = await bookingService.lookupTicket(value, ctx.companyId, ctx);
    res.status(result.booking ? 200 : 404).json(result);
  } catch (error) {
    next(error);
  }
}

async function checkIn(req, res, next) {
  try {
    const ctx = actorContext(req);
    const value = requireScannerValue(req, res);
    if (!value) return;
    const result = await bookingService.validateTicket(value, ctx.userId, ctx.companyId, { ...ctx, note: req.body.note || '' });
    if (wantsJson(req)) {
      res.status(result.ok ? 200 : 409).json(result);
      return;
    }
    redirectWithScanResult(res, result);
  } catch (error) {
    next(error);
  }
}

async function noShow(req, res, next) {
  try {
    const ctx = actorContext(req);
    const value = requireScannerValue(req, res);
    if (!value) return;
    const result = await bookingService.markNoShow(value, ctx.userId, ctx.companyId, req.body.note || '', ctx);
    if (wantsJson(req)) {
      res.status(result.ok ? 200 : 409).json(result);
      return;
    }
    redirectWithScanResult(res, result);
  } catch (error) {
    next(error);
  }
}

module.exports = { lookup, checkIn, noShow };
