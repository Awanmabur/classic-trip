const actionService = require('../../services/dashboard/actionService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyId(req) {
  return resolveCompanyId(req);
}

function actorId(req) {
  return req.session?.user?.id || 'company-admin';
}


async function createDriverRequest(req, res, next) {
  try {
    await actionService.createDriverInviteRequest(companyId(req), req.body, actorId(req));
    res.redirect('/company/driver-requests');
  } catch (error) {
    next(error);
  }
}

async function updateSettings(req, res, next) {
  try {
    await actionService.updateCompanySettings(companyId(req), req.body, actorId(req));
    res.redirect('/company/settings');
  } catch (error) {
    next(error);
  }
}

async function requestPayout(req, res, next) {
  try {
    await actionService.requestCompanyPayout(companyId(req), req.body, actorId(req));
    res.redirect('/company/payouts');
  } catch (error) {
    next(error);
  }
}

async function createBooking(req, res, next) {
  try {
    await actionService.createManualBooking(companyId(req), req.body, actorId(req));
    res.redirect('/company/bookings');
  } catch (error) {
    next(error);
  }
}

async function createNotice(req, res, next) {
  try {
    await actionService.createCompanyNotice(companyId(req), req.body, actorId(req));
    res.redirect('/company/support');
  } catch (error) {
    next(error);
  }
}

async function updateSupport(req, res, next) {
  try {
    await actionService.updateSupportTicket(companyId(req), req.params.id, req.body, actorId(req));
    res.redirect('/company/support');
  } catch (error) {
    next(error);
  }
}

async function replyToReview(req, res, next) {
  try {
    await actionService.replyToReview(companyId(req), req.params.id, req.body, actorId(req));
    res.redirect('/company/reviews');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  updateSettings,
  requestPayout,
  createBooking,
  createNotice,
  updateSupport,
  replyToReview,
  createDriverRequest,
};
