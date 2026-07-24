const verificationService = require('../../services/onboarding/verificationService');
const mediaReviewService = require('../../services/onboarding/mediaReviewService');

function actorId(req) {
  return req.session?.user?.id || 'admin-system';
}

function assertPartnerOnlyEmployeeManagement(targetType) {
  if (String(targetType || '').toLowerCase() !== 'driver') return;
  const error = new Error('Driver and employee approval belongs to the Partner Admin. Super Admin approves only partner companies.');
  error.status = 403;
  throw error;
}

function redirectBack(req, res) {
  const next = String(req.body.next || '');
  // Only allow a local, relative path — a value like "//evil.com" or "https://evil.com" would
  // otherwise send a privileged, already-authenticated admin off the platform after their action.
  const isLocalPath = next.startsWith('/') && !next.startsWith('//') && !next.includes('://');
  res.redirect(isLocalPath ? next : '/admin/kyc');
}

async function approveItem(req, res, next) {
  try {
    assertPartnerOnlyEmployeeManagement(req.params.targetType);
    await verificationService.reviewChecklistItem(req.params.targetType, req.params.targetId, req.params.key, 'approved', actorId(req), req.body);
    redirectBack(req, res);
  } catch (error) {
    next(error);
  }
}

async function rejectItem(req, res, next) {
  try {
    assertPartnerOnlyEmployeeManagement(req.params.targetType);
    await verificationService.reviewChecklistItem(req.params.targetType, req.params.targetId, req.params.key, 'rejected', actorId(req), req.body);
    redirectBack(req, res);
  } catch (error) {
    next(error);
  }
}

async function waiveItem(req, res, next) {
  try {
    assertPartnerOnlyEmployeeManagement(req.params.targetType);
    await verificationService.reviewChecklistItem(req.params.targetType, req.params.targetId, req.params.key, 'waived', actorId(req), req.body);
    redirectBack(req, res);
  } catch (error) {
    next(error);
  }
}

async function activate(req, res, next) {
  try {
    assertPartnerOnlyEmployeeManagement(req.params.targetType);
    await verificationService.activateTarget(req.params.targetType, req.params.targetId, actorId(req));
    redirectBack(req, res);
  } catch (error) {
    next(error);
  }
}

async function rejectTarget(req, res, next) {
  try {
    assertPartnerOnlyEmployeeManagement(req.params.targetType);
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
