const companyService = require('../../services/company/companyService');
const { withUploadedMedia } = require('./mediaHelpers');

function companyId(req) {
  return req.session?.user?.companyId || req.body.companyId || 'company-01';
}

async function upload(req, res, next) {
  try {
    const target = req.body.target || 'companyLogo';
    const allowed = ['companyLogo', 'companyCover', 'companyDocument'];
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
      asset: payload.mediaAsset,
    });
    res.redirect('/company/settings');
  } catch (error) {
    next(error);
  }
}

module.exports = { upload };
