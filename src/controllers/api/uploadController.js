const uploadService = require('../../services/media/uploadService');
const companyService = require('../../services/company/companyService');

async function upload(req, res, next) {
  try {
    const target = req.body.target || 'blog';
    const asset = await uploadService.uploadMedia(req.file, target);
    let attachment = null;
    if (req.body.companyId && ['companyLogo', 'companyCover', 'companyDocument', 'listingMedia', 'busListing', 'hotelListing'].includes(target)) {
      attachment = await companyService.attachMedia({
        companyId: req.body.companyId,
        target,
        targetId: req.body.targetId || req.body.listingId,
        asset,
      });
    }
    res.status(201).json({ asset, attachment });
  } catch (error) {
    next(error);
  }
}

function signature(req, res) { res.json({ uploadPreset: 'signed-server-upload-required', folder: req.body.folder || 'classic-trip' }); }
module.exports = { upload, signature };
