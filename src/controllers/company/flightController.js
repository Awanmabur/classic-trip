'use strict';

const flightSetupService = require('../../modules/flight/services/flightSetupService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyId(req) { return resolveCompanyId(req); }
function actorId(req) { return req.session?.user?.id || 'company-admin'; }
// The legacy URL is retained as a stable bookmark, but the page is an agency compliance and supplier-access view.
function respond(req, res, data, fallback = '/company/flight-suppliers') {
  if (req.accepts(['html', 'json']) === 'json' || req.xhr) return res.json({ data });
  if (req.flash) req.flash('success', 'Flight agency profile saved successfully.');
  return res.redirect(req.get('referer') || fallback);
}

async function saveAgencyProfile(req, res, next) {
  try { return respond(req, res, await flightSetupService.saveAgencyDraft(companyId(req), req.body, actorId(req))); }
  catch (error) { return next(error); }
}
async function submitAgencyProfile(req, res, next) {
  try { return respond(req, res, await flightSetupService.submitAgencyProfile(companyId(req), req.body, actorId(req))); }
  catch (error) { return next(error); }
}

module.exports = { saveAgencyProfile, submitAgencyProfile };
