const uploadService = require('../../services/media/uploadService');

function targetForListing(serviceType = '') {
  if (serviceType === 'hotel') return 'hotelListing';
  if (serviceType === 'bus') return 'busListing';
  return 'listingMedia';
}

async function withUploadedMedia(req, payload = {}, target = 'listingMedia') {
  if (!req.file) return payload;
  const mediaAsset = await uploadService.uploadMedia(req.file, target);
  return { ...payload, mediaAsset };
}

module.exports = { targetForListing, withUploadedMedia };
