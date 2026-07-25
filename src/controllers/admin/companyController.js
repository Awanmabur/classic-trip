const companyService = require('../../services/company/companyService');
const { COMPANY_STATUS } = require('../../config/constants');
const uploadService = require('../../services/media/uploadService');
const partnerMaterializationService = require('../../services/onboarding/partnerMaterializationService');

async function create(req, res, next) {
  try {
    const company = await companyService.createCompany(req.body);
    if (req.file) {
      const target = req.body.mediaTarget === 'companyDocument' ? 'companyDocument' : 'companyLogo';
      const asset = await uploadService.uploadMedia(req.file, target);
      await companyService.attachMedia({
        companyId: company.id,
        target,
        asset,
        metadata: {
          uploadedBy: req.session?.user?.id || 'admin-system',
          documentType: req.body.documentType,
          documentReference: req.body.documentReference,
          note: req.body.reviewNotes || req.body.note,
        },
      });
    }
    res.redirect('/admin/companies');
  } catch (error) {
    next(error);
  }
}

async function updateCommission(req, res, next) {
  try {
    await companyService.updateCommercialTerms(
      req.params.slug,
      req.body,
      req.session?.user?.id || 'admin-system'
    );
    if (req.flash) req.flash('success', 'Partner commission percentage updated. Existing bookings keep their historical percentage.');
    res.redirect('/admin/companies');
  } catch (error) {
    next(error);
  }
}

async function approve(req, res, next) {
  try {
    const actorId = req.session?.user?.id || 'admin-system';
    const company = await companyService.setVerificationStatus(req.params.slug, COMPANY_STATUS.VERIFIED, actorId, req.body);
    const materialization = await partnerMaterializationService.materializeApprovedPartner(company, { id: actorId, userId: actorId, role: 'super_admin' });
    if (req.flash) {
      const needsAction = Array.isArray(materialization?.missing) && materialization.missing.length;
      req.flash(needsAction ? 'warning' : 'success', needsAction
        ? `Partner approved, but onboarding still needs: ${materialization.missing.join(', ')}.`
        : 'Partner approved and the correct service workspace was prepared.');
    }
    res.redirect('/admin/companies');
  } catch (error) {
    next(error);
  }
}

async function reject(req, res, next) {
  try {
    await companyService.setVerificationStatus(req.params.slug, COMPANY_STATUS.REJECTED, req.session?.user?.id || 'admin-system', req.body);
    res.redirect('/admin/companies');
  } catch (error) {
    next(error);
  }
}

async function suspend(req, res, next) {
  try {
    await companyService.setVerificationStatus(req.params.slug, COMPANY_STATUS.SUSPENDED, req.session?.user?.id || 'admin-system', req.body);
    res.redirect('/admin/companies');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, updateCommission, approve, reject, suspend };
