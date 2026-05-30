const companyService = require('../../services/company/companyService');
const { targetForListing, withUploadedMedia } = require('./mediaHelpers');

function companyId(req) {
  return req.session?.user?.companyId || req.body.companyId || 'company-01';
}

async function create(req, res, next) {
  try {
    const payload = await withUploadedMedia(req, req.body, targetForListing(req.body.serviceType || req.body.group));
    await companyService.createListing(companyId(req), payload);
    res.redirect('/company/listings');
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const payload = await withUploadedMedia(req, req.body, targetForListing(req.body.serviceType || req.body.group));
    await companyService.updateListing(companyId(req), req.params.id, payload);
    res.redirect('/company/listings');
  } catch (error) {
    next(error);
  }
}

async function publish(req, res, next) {
  try {
    await companyService.publishListing(companyId(req), req.params.id);
    res.redirect('/company/listings');
  } catch (error) {
    next(error);
  }
}

async function archive(req, res, next) {
  try {
    await companyService.archiveListing(companyId(req), req.params.id);
    res.redirect('/company/listings');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, update, publish, archive };
