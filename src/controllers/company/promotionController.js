'use strict';

const promotionService = require('../../services/promotion/promotionService');
const { resolveCompanyId } = require('../../utils/companyScope');

function actorId(req) {
  return req.session?.user?.id || 'company-user';
}

async function create(req, res, next) {
  try {
    const companyId = resolveCompanyId(req, { allowOverride: true });
    const result = await promotionService.markSponsored(req.body.listingId, companyId, req.body, actorId(req));
    if (req.flash) req.flash('success', `Promotion “${result.campaign.name}” is active.`);
    res.redirect('/company/dashboard/ads');
  } catch (error) { next(error); }
}

function changeStatus(status) {
  return async (req, res, next) => {
    try {
      const companyId = resolveCompanyId(req, { allowOverride: true });
      const campaign = await promotionService.setCampaignStatus(req.params.id, companyId, status, actorId(req));
      if (req.flash) req.flash('success', `Promotion “${campaign.name}” is now ${status}.`);
      res.redirect('/company/dashboard/ads');
    } catch (error) { next(error); }
  };
}

module.exports = {
  create,
  pause: changeStatus('paused'),
  resume: changeStatus('active'),
  end: changeStatus('expired'),
};
