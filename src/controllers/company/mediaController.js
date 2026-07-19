const companyService = require('../../services/company/companyService');
const { withUploadedMedia } = require('./mediaHelpers');
const uploadService = require('../../services/media/uploadService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyId(req) {
  return resolveCompanyId(req);
}

async function upload(req, res, next) {
  try {
    const target = req.body.target || req.body.mediaTarget || 'companyLogo';
    const allowed = ['companyLogo', 'companyCover', 'companyDocument', 'companyVerificationDocument', 'listingMedia', 'busListing', 'hotelListing', 'vehiclePhoto', 'vehicleDocument', 'driverDocument', 'hotelPropertyMedia', 'roomTypeMedia', 'roomUnitMedia', 'guestDocument'];
    if (!allowed.includes(target)) {
      const error = new Error('Unsupported company media target');
      error.status = 422;
      throw error;
    }
    if (!req.file) {
      const error = new Error('Choose a file to upload');
      error.status = 422;
      throw error;
    }
    const payload = await withUploadedMedia(req, {}, target);
    await companyService.attachMedia({
      companyId: companyId(req),
      target,
      targetId: req.body.targetId || req.body.listingId || req.body.vehicleId || req.body.driverId || req.body.propertyId || req.body.roomTypeId || req.body.roomUnitId || req.body.bookingRef,
      asset: payload.mediaAsset,
      metadata: {
        uploadedBy: req.session?.user?.id || '',
        documentType: req.body.documentType,
        documentReference: req.body.documentReference,
        targetId: req.body.targetId || req.body.listingId || req.body.vehicleId || req.body.driverId || req.body.propertyId || req.body.roomTypeId || req.body.roomUnitId || req.body.bookingRef,
        note: req.body.note,
        label: req.body.label,
        alt: req.body.alt,
      },
    });
    if (req.flash) req.flash('success', 'Media/document uploaded for review.');
    res.redirect(req.body.next || '/company/profile');
  } catch (error) {
    next(error);
  }
}

async function destroy(req, res, next) {
  try {
    const target = req.body.target || 'companyDocument';
    const allowed = ['companyLogo', 'companyCover', 'companyDocument', 'companyVerificationDocument', 'listingMedia', 'busListing', 'hotelListing', 'vehiclePhoto', 'vehicleDocument', 'driverDocument', 'hotelPropertyMedia', 'roomTypeMedia', 'roomUnitMedia', 'guestDocument'];
    if (!allowed.includes(target)) {
      const error = new Error('Unsupported company media target');
      error.status = 422;
      throw error;
    }
    const removal = await companyService.removeMedia({
      companyId: companyId(req),
      target,
      targetId: req.body.targetId || req.body.listingId || req.body.vehicleId || req.body.driverId || req.body.propertyId || req.body.roomTypeId || req.body.roomUnitId || req.body.bookingRef,
      publicId: req.body.publicId,
      actorId: req.session?.user?.id || 'company-user',
    });
    if (removal.media) await uploadService.deleteMedia(removal.media);
    if (req.flash) req.flash('success', 'Media/document removed.');
    res.redirect(req.body.next || '/company/profile');
  } catch (error) {
    next(error);
  }
}

module.exports = { upload, destroy };
