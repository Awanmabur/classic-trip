'use strict';

const companyService = require('../../services/company/companyService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyId(req) { return resolveCompanyId(req); }
function actor(req) { return req.session?.user?.id || 'company-admin'; }

async function create(req, res, next) {
  try {
    await companyService.createFareProduct(companyId(req), req.body, actor(req));
    res.redirect('/company/schedules-fares');
  } catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    await companyService.updateFareProduct(companyId(req), req.params.id, req.body, actor(req));
    res.redirect('/company/schedules-fares');
  } catch (error) { next(error); }
}

async function upsertSegment(req, res, next) {
  try {
    await companyService.upsertSegmentFare(companyId(req), req.params.id, req.body, actor(req));
    res.redirect('/company/schedules-fares');
  } catch (error) { next(error); }
}

async function upsertSegmentFromBody(req, res, next) {
  try {
    await companyService.upsertSegmentFare(companyId(req), req.body.fareProductId, req.body, actor(req));
    res.redirect('/company/schedules-fares');
  } catch (error) { next(error); }
}

module.exports = { create, update, upsertSegment, upsertSegmentFromBody };
