const catalogService = require('../services/marketplace/catalogService');
const logger = require('../config/logger');

function normalizeReferralCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!code || code.length > 80 || !/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) return '';
  return code;
}

function normalizeListingId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) return '';
  return id;
}

function attachReferral(req, res, next) {
  const queryCode = normalizeReferralCode(req.query.ref);
  const cookieCode = normalizeReferralCode(req.cookies?.ct_ref);
  const sessionCode = normalizeReferralCode(req.session?.referralCode);

  if (queryCode) {
    res.cookie('ct_ref', queryCode, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    req.session.referralCode = queryCode;
    const listingId = normalizeListingId(req.query.listingId);
    if (listingId) {
      catalogService.recordReferralClick(queryCode, listingId, req).catch((error) => {
        logger.warn('Referral click could not be recorded', { code: queryCode, listingId, error: error.message });
      });
    }
  }

  res.locals.referralCode = queryCode || cookieCode || sessionCode || '';
  next();
}

module.exports = { attachReferral, normalizeReferralCode, normalizeListingId };
