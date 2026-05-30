const companyService = require('../../services/company/companyService');
const { COMPANY_STATUS } = require('../../config/constants');
const uploadService = require('../../services/media/uploadService');

async function create(req, res, next) {
  try {
    const company = await companyService.createCompany(req.body);
    if (req.file) {
      const target = req.body.mediaTarget === 'companyDocument' ? 'companyDocument' : 'companyLogo';
      const asset = await uploadService.uploadMedia(req.file, target);
      await companyService.attachMedia({ companyId: company.id, target, asset });
    }
    res.redirect('/admin/companies');
  } catch (error) {
    next(error);
  }
}

async function approve(req, res, next) {
  try {
    await companyService.setVerificationStatus(req.params.slug, COMPANY_STATUS.VERIFIED, req.session?.user?.id || 'admin-system');
    res.redirect('/admin/companies');
  } catch (error) {
    next(error);
  }
}

async function reject(req, res, next) {
  try {
    await companyService.setVerificationStatus(req.params.slug, COMPANY_STATUS.REJECTED, req.session?.user?.id || 'admin-system');
    res.redirect('/admin/companies');
  } catch (error) {
    next(error);
  }
}

async function suspend(req, res, next) {
  try {
    await companyService.setVerificationStatus(req.params.slug, COMPANY_STATUS.SUSPENDED, req.session?.user?.id || 'admin-system');
    res.redirect('/admin/companies');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, approve, reject, suspend };
