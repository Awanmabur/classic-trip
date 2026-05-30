const companyService = require('../../services/company/companyService');
const { withUploadedMedia } = require('./mediaHelpers');

function companyId(req) {
  return req.session?.user?.companyId || req.body.companyId || 'company-01';
}

async function create(req, res, next) {
  try {
    const payload = await withUploadedMedia(req, req.body, 'hotelListing');
    await companyService.createRoom(companyId(req), payload);
    res.redirect('/company/rooms');
  } catch (error) {
    next(error);
  }
}

async function updateInventory(req, res, next) {
  try {
    const payload = await withUploadedMedia(req, req.body, 'hotelListing');
    await companyService.updateRoomInventory(companyId(req), req.params.id, payload);
    res.redirect('/company/rooms');
  } catch (error) {
    next(error);
  }
}

async function archive(req, res, next) {
  try {
    await companyService.archiveRoom(companyId(req), req.params.id);
    res.redirect('/company/rooms');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, updateInventory, archive };
