const pipelineService = require('../../services/onboarding/partnerPipelineService');

function actorId(req) {
  return req.session?.user?.id || 'admin-system';
}

async function createLead(req, res, next) {
  try {
    await pipelineService.createLead({ ...req.body, sourceChannel: req.body.sourceChannel || 'manual_admin' }, actorId(req));
    res.redirect('/admin/partners#leads');
  } catch (error) {
    next(error);
  }
}

async function createSession(req, res, next) {
  try {
    await pipelineService.scheduleSession(req.body, actorId(req));
    res.redirect('/admin/partners#sessions');
  } catch (error) {
    next(error);
  }
}

async function createAgreement(req, res, next) {
  try {
    await pipelineService.createAgreement(req.body, actorId(req));
    res.redirect('/admin/partners#agreements');
  } catch (error) {
    next(error);
  }
}

async function approveAgreement(req, res, next) {
  try {
    await pipelineService.approveAgreementAndInvite(req.params.id, actorId(req), req.body);
    res.redirect('/admin/partners#agreements');
  } catch (error) {
    next(error);
  }
}

async function rejectAgreement(req, res, next) {
  try {
    await pipelineService.updateAgreementStatus(req.params.id, 'rejected', actorId(req), req.body.reason || req.body.note || 'Rejected');
    res.redirect('/admin/partners#agreements');
  } catch (error) {
    next(error);
  }
}

module.exports = { createLead, createSession, createAgreement, approveAgreement, rejectAgreement };
