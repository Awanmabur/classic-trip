const companyService = require('../../services/company/companyService');
const { withUploadedMedia } = require('./mediaHelpers');

function companyId(req) {
  return req.session?.user?.companyId || req.body.companyId || 'company-01';
}

async function create(req, res, next) {
  try {
    const payload = await withUploadedMedia(req, req.body, 'listingMedia');
    await companyService.createVehicle(companyId(req), payload);
    res.redirect('/company/vehicles');
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const payload = await withUploadedMedia(req, req.body, 'listingMedia');
    await companyService.updateVehicle(companyId(req), req.params.id, payload);
    res.redirect('/company/vehicles');
  } catch (error) {
    next(error);
  }
}

async function archive(req, res, next) {
  try {
    await companyService.archiveVehicle(companyId(req), req.params.id);
    res.redirect('/company/vehicles');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, update, archive };
