const busServiceOnboarding = require('../../services/company/busServiceOnboarding');
const uploadService = require('../../services/media/uploadService');
const { resolveCompanyId } = require('../../utils/companyScope');

function actorId(req) {
  return req.session?.user?.id || 'company-admin';
}

async function createBusService(req, res, next) {
  const uploadedAssets = [];
  try {
    const companyId = resolveCompanyId(req);
    const listingImage = req.files?.listingImageFile?.[0];
    const vehicleImage = req.files?.vehicleImageFile?.[0];
    const listingMediaAsset = listingImage ? await uploadService.uploadMedia(listingImage, 'busListing') : null;
    const vehicleMediaAsset = vehicleImage ? await uploadService.uploadMedia(vehicleImage, 'vehiclePhoto') : null;
    if (listingMediaAsset) uploadedAssets.push(listingMediaAsset);
    if (vehicleMediaAsset) uploadedAssets.push(vehicleMediaAsset);
    const payload = {
      listing: { ...(req.body.listing || {}), ...(listingMediaAsset ? { mediaAsset: listingMediaAsset } : {}) },
      vehicle: { ...(req.body.vehicle || {}), ...(vehicleMediaAsset ? { mediaAsset: vehicleMediaAsset } : {}) },
      route: req.body.route || {},
      fare: req.body.fare || {},
      schedule: req.body.schedule || {},
    };
    const result = await busServiceOnboarding.createBusService(companyId, payload, {
      actorId: actorId(req),
      idempotencyKey: req.body.idempotencyKey || req.get('Idempotency-Key') || '',
    });
    if (result.replayed) await Promise.allSettled(uploadedAssets.map((asset) => uploadService.deleteMedia(asset)));
    res.redirect(`/company/schedules?created=${encodeURIComponent(result.listing.id)}`);
  } catch (error) {
    await Promise.allSettled(uploadedAssets.map((asset) => uploadService.deleteMedia(asset)));
    next(error);
  }
}

module.exports = { createBusService };
