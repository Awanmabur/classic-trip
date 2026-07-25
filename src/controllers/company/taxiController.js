'use strict';

const taxiSetupService = require('../../modules/taxi/services/taxiSetupService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyId(req) { return resolveCompanyId(req); }
function actorId(req) { return req.session?.user?.id || 'company-admin'; }
function respond(req, res, data, fallback = '/company/taxi-vehicles') {
  if (req.accepts(['html', 'json']) === 'json' || req.xhr) return res.json({ data });
  if (req.flash) req.flash('success', 'Taxi fleet record submitted for platform review.');
  return res.redirect(req.get('referer') || fallback);
}

async function createVehicle(req, res, next) {
  try { return respond(req, res, await taxiSetupService.createVehicle(companyId(req), req.body, actorId(req))); }
  catch (error) { return next(error); }
}

module.exports = { createVehicle };
