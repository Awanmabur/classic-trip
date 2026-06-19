const uploadService = require('../../services/media/uploadService');
const companyService = require('../../services/company/companyService');
const blogService = require('../../services/content/blogService');

const COMPANY_TARGETS = ['companyLogo', 'companyCover', 'companyDocument', 'listingMedia', 'busListing', 'hotelListing'];
const ADMIN_ROLES = new Set(['super_admin', 'admin', 'content_admin']);
const COMPANY_ROLES = new Set(['company_admin', 'super_admin']);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function currentUser(req) {
  return req.session?.user || null;
}

function isAdmin(user) {
  return ADMIN_ROLES.has(user?.role);
}

function resolvedCompanyId(req) {
  const user = currentUser(req);
  if (isAdmin(user)) return req.body.companyId || req.query.companyId || user.companyId || '';
  return user?.companyId || '';
}

function authorize(req, target) {
  const user = currentUser(req);
  if (!user) fail('Authentication is required before uploading media', 401);
  if (target === 'blog') {
    if (!isAdmin(user)) fail('Only content administrators can manage blog media', 403);
    return { user };
  }
  if (COMPANY_TARGETS.includes(target)) {
    if (!COMPANY_ROLES.has(user.role)) fail('Only company administrators can manage company media', 403);
    const companyId = resolvedCompanyId(req);
    if (!companyId) fail('Company ID is required for company media uploads', 422);
    if (!isAdmin(user) && req.body.companyId && req.body.companyId !== user.companyId) {
      fail('Company media can only be changed by its own company administrator', 403);
    }
    return { user, companyId };
  }
  fail('Unsupported upload target', 422);
}

function metadataFromRequest(req) {
  return {
    uploadedBy: currentUser(req)?.id || '',
    alt: req.body.alt,
    label: req.body.label,
    documentType: req.body.documentType,
    documentReference: req.body.documentReference || req.body.reference,
    note: req.body.note || req.body.reviewNotes,
  };
}

async function upload(req, res, next) {
  try {
    const target = req.body.target || 'blog';
    const auth = authorize(req, target);
    if (!req.file) fail('Choose a file to upload', 422);
    const asset = await uploadService.uploadMedia(req.file, target);
    let attachment = null;
    if (COMPANY_TARGETS.includes(target)) {
      attachment = await companyService.attachMedia({
        companyId: auth.companyId,
        target,
        targetId: req.body.targetId || req.body.listingId,
        asset,
        metadata: metadataFromRequest(req),
      });
    }
    if (target === 'blog' && req.body.blogId) {
      attachment = await blogService.attachMedia(req.body.blogId, asset, metadataFromRequest(req));
    }
    res.status(201).json({ asset, attachment });
  } catch (error) {
    next(error);
  }
}

async function destroy(req, res, next) {
  try {
    const target = req.body.target || 'blog';
    const auth = authorize(req, target);
    let removal = null;
    if (COMPANY_TARGETS.includes(target)) {
      removal = await companyService.removeMedia({
        companyId: auth.companyId,
        target,
        targetId: req.body.targetId || req.body.listingId,
        publicId: req.body.publicId,
        actorId: auth.user.id,
      });
    } else if (target === 'blog' && req.body.blogId) {
      removal = await blogService.removeMedia(req.body.blogId, req.body.publicId);
    }
    const media = removal?.media || { publicId: req.body.publicId, resourceType: req.body.resourceType || 'image' };
    const deleted = await uploadService.deleteMedia(media, req.body.resourceType || 'image');
    res.json({ deleted, removal });
  } catch (error) {
    next(error);
  }
}

function signature(req, res, next) {
  try {
    const target = req.body.target || 'blog';
    authorize(req, target);
    res.json({ uploadPreset: 'signed-server-upload-required', folder: uploadService.folders[target] || uploadService.folders.blog });
  } catch (error) {
    next(error);
  }
}

module.exports = { upload, destroy, signature };
