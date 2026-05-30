const store = require('../services/data/demoStore');

function attachReferral(req, res, next) {
  const ref = req.query.ref || req.cookies?.ct_ref;
  if (req.query.ref) {
    res.cookie('ct_ref', req.query.ref, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 });
    req.session.referralCode = req.query.ref;
    if (req.query.listingId) store.recordReferralClick(req.query.ref, req.query.listingId, req);
  }
  res.locals.referralCode = ref || req.session?.referralCode || '';
  next();
}

module.exports = { attachReferral };
