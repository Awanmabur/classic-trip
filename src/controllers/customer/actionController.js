const customerService = require('../../services/customer/customerService');
const { pushFlash } = require('../../middlewares/flash');

async function saveTrip(req, res, next) {
  try { await customerService.saveTrip(req); return res.redirect('/saved'); } catch (error) { return next(error); }
}

async function topUpWallet(req, res, next) {
  try { await customerService.topUpWallet(req); return res.redirect('/account#wallet'); } catch (error) { return next(error); }
}

async function becomePromoter(req, res, next) {
  try {
    const result = await customerService.applyForPromoter(req);
    pushFlash(req, 'success', result.replayed ? 'Your promoter application is already under review.' : 'Your promoter application was submitted for verification.');
    return res.redirect('/account#promoter-application');
  } catch (error) { return next(error); }
}

async function updateSecurity(req, res, next) {
  try { await customerService.updateSecurity(req); return res.redirect('/account#security'); } catch (error) { return next(error); }
}

module.exports = { saveTrip, topUpWallet, becomePromoter, updateSecurity };
