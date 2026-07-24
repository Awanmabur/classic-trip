const companyService = require('../../services/company/companyService');
const { targetForListing, withUploadedMedia } = require('./mediaHelpers');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyId(req) {
  return resolveCompanyId(req);
}

async function create(req, res, next) {
  try {
    const payload = await withUploadedMedia(req, { ...req.body, actorId: req.session?.user?.id || 'company-admin' }, targetForListing(req.body.serviceType || req.body.group));
    await companyService.createListing(companyId(req), payload);
    res.redirect('/company/listings');
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const payload = await withUploadedMedia(req, { ...req.body, actorId: req.session?.user?.id || 'company-admin' }, targetForListing(req.body.serviceType || req.body.group));
    const listing = await companyService.updateListing(companyId(req), req.params.id, payload);
    if (req.flash) {
      const status = String(listing?.status || '').toLowerCase();
      const label = String(listing?.serviceType || '').toLowerCase() === 'bus' ? 'Bus listing' : 'Listing';
      req.flash('success', status === 'active'
        ? (listing?.bookable
          ? `${label} activated, published, and open for booking.`
          : `${label} activated and published publicly. Publish a future dated departure to enable Book now.`)
        : `${label} saved with status: ${status || 'unchanged'}.`);
    }
    res.redirect('/company/listings');
  } catch (error) {
    if (req.flash && [409, 422].includes(Number(error.status))) {
      req.flash('error', error.message);
      return res.redirect('/company/listings');
    }
    next(error);
  }
}

async function publish(req, res, next) {
  try {
    const listing = await companyService.publishListing(companyId(req), req.params.id, req.session?.user?.id || 'company-admin');
    if (req.flash) {
      const label = String(listing?.serviceType || '').toLowerCase() === 'bus' ? 'Bus listing' : 'Listing';
      req.flash('success', listing?.bookable
        ? `${label} activated, published, and open for booking.`
        : `${label} activated and published publicly. Publish a future dated departure to enable Book now.`);
    }
    res.redirect('/company/listings');
  } catch (error) {
    if (req.flash && [409, 422].includes(Number(error.status))) {
      req.flash('error', error.message);
      return res.redirect('/company/listings');
    }
    next(error);
  }
}

async function archive(req, res, next) {
  try {
    await companyService.archiveListing(companyId(req), req.params.id, req.session?.user?.id || 'company-admin');
    res.redirect('/company/listings');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, update, publish, archive };
