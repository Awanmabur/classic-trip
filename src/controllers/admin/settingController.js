const actionController = require('./actionController');

function update(req, res, next) {
  return actionController.updateFinanceRules(req, res, next);
}

module.exports = { update };
