'use strict';

const companyService = require('../../services/company/companyService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyId(req) { return resolveCompanyId(req); }
function actor(req) { return req.session?.user?.id || 'company-admin'; }
function redirectFor(row = {}) { return row.serviceType === 'hotel' ? '/company/hotel-dashboard#hotel-rooms' : '/company/schedules-fares#schedules'; }

async function create(req, res, next) {
  try {
    const row = await companyService.createServiceAddon(companyId(req), req.body, actor(req));
    res.redirect(redirectFor(row));
  } catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    const row = await companyService.updateServiceAddon(companyId(req), req.params.id, req.body, actor(req));
    res.redirect(redirectFor(row));
  } catch (error) { next(error); }
}

async function archive(req, res, next) {
  try {
    const row = await companyService.archiveServiceAddon(companyId(req), req.params.id, actor(req));
    res.redirect(redirectFor(row));
  } catch (error) { next(error); }
}

module.exports = { create, update, archive };
