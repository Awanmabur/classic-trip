const mongoDashboardService = require('../../services/dashboard/mongoDashboardService');
async function list(req, res, next) { try { res.json(await mongoDashboardService.listEntity('users', { role: 'promoter' }, { limit: req.query.limit || 500 })); } catch (error) { next(error); } }
module.exports = { list };
