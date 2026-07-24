const customerService = require('../../services/customer/customerService');
async function create(req, res, next) { try { await customerService.createSupportTicket(req); return res.redirect('/promoter/dashboard#support'); } catch (error) { return next(error); } }
module.exports = { create };
