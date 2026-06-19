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

async function updateSeats(req, res, next) {
  try {
    await companyService.updateVehicleSeatTemplate(companyId(req), req.params.id, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/seat-maps');
  } catch (error) {
    next(error);
  }
}

async function updateSeatTemplate(req, res, next) {
  try {
    await companyService.updateVehicleSeatTemplate(companyId(req), req.body.vehicleId, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/seat-maps');
  } catch (error) {
    next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    await companyService.updateVehicleStatus(companyId(req), req.params.id, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/vehicles');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, update, archive, updateSeats, updateSeatTemplate, updateStatus };
