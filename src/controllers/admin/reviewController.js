const workflowService = require('../../services/support/workflowService');

function moderate(req, res) {
  workflowService.moderateReview(req.params.id, req.body.status || 'hidden');
  res.redirect('/admin/reviews');
}
module.exports = { moderate };
