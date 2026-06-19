const verificationService = require('../../services/onboarding/verificationService');
const mediaReviewService = require('../../services/onboarding/mediaReviewService');

function actorId(req) {
  return req.session?.user?.id || 'admin-system';
}

function redirectBack(req, res) {
  res.redirect(req.body.next || '/admin/kyc');
}

async function approveItem(req, res, next) {
  try {
    await verificationService.reviewChecklistItem(req.params.targetType, req.params.targetId, req.params.key, 'approved', actorId(req), req.body);
    redirectBack(req, res);
  } catch (error) {
    next(error);
  }
}

async function rejectItem(req, res, next) {
  try {
    await verificationService.reviewChecklistItem(req.params.targetType, req.params.targetId, req.params.key, 'rejected', actorId(req), req.body);
    redirectBack(req, res);
  } catch (error) {
    next(error);
  }
}

async function waiveItem(req, res, next) {
  try {
    await verificationService.reviewChecklistItem(req.params.targetType, req.params.targetId, req.params.key, 'waived', actorId(req), req.body);
    redirectBack(req, res);
  } catch (error) {
    next(error);
  }
}

async function activate(req, res, next) {
  try {
    await verificationService.activateTarget(req.params.targetType, req.params.targetId, actorId(req));
    redirectBack(req, res);
  } catch (error) {
    next(error);
  }
}

async function rejectTarget(req, res, next) {
  try {
    await verificationService.rejectTarget(req.params.targetType, req.params.targetId, actorId(req), req.body.reason || req.body.note || '');
    redirectBack(req, res);
  } catch (error) {
    next(error);
  }
}

async function reviewDocument(req, res, next) {
  try {
    await mediaReviewService.reviewDocument(req.params.targetType, req.params.targetId, req.params.publicId, req.body.status || 'approved', actorId(req), req.body);
    if (req.flash) req.flash('success', 'Document review saved.');
    redirectBack(req, res);
  } catch (error) {
    next(error);
  }
}

module.exports = { approveItem, rejectItem, waiveItem, activate, rejectTarget, reviewDocument };
