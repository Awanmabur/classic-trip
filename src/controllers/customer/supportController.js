const customerService = require('../../services/customer/customerService');

async function create(req, res, next) {
  try { await customerService.createSupportTicket(req); return res.redirect('/account#support'); } catch (error) { return next(error); }
}

module.exports = { create };
