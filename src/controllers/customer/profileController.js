const customerService = require('../../services/customer/customerService');

async function update(req, res, next) {
  try { await customerService.updateProfile(req); return res.redirect('/account#profile'); } catch (error) { return next(error); }
}

module.exports = { update };
