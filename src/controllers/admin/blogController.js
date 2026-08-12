'use strict';

const blogService = require('../../services/content/blogService');
const uploadService = require('../../services/media/uploadService');

function redirectTarget(req) {
  return String(req.originalUrl || '').startsWith('/content/')
    ? '/content/dashboard/blogs'
    : '/admin/blogs';
}

function actorId(req) {
  return req.session?.user?.id || req.user?.id || 'admin';
}

async function uploadBlogImage(req) {
  if (!req.file) return null;
  return uploadService.uploadMedia(req.file, 'blog');
}

async function cleanupOrphan(asset) {
  if (!asset?.publicId) return;
  try { await uploadService.deleteMedia(asset); } catch (_) { /* best effort */ }
}

async function create(req, res, next) {
  let asset = null;
  try {
    asset = await uploadBlogImage(req);
    const payload = { ...req.body };
    if (asset) payload.image = '';
    const blog = await blogService.createBlog(payload, actorId(req));
    if (asset) await blogService.attachMedia(blog.id, asset, { uploadedBy: actorId(req), alt: req.body.imageAlt, label: blog.title });
    if (req.flash) req.flash('success', `Blog “${blog.title}” created${asset ? ' with its Cloudinary cover image' : ''}.`);
    res.redirect(redirectTarget(req));
  } catch (error) {
    if (asset) await cleanupOrphan(asset);
    next(error);
  }
}

async function update(req, res, next) {
  let asset = null;
  try {
    asset = await uploadBlogImage(req);
    const payload = { ...req.body };
    if (asset) delete payload.image;
    const blog = await blogService.updateBlog(req.params.id, payload, actorId(req));
    if (asset) await blogService.attachMedia(blog.id, asset, { uploadedBy: actorId(req), alt: req.body.imageAlt, label: blog.title });
    if (req.flash) req.flash('success', `Blog “${blog.title}” updated${asset ? ' with a new Cloudinary cover image' : ''}.`);
    res.redirect(redirectTarget(req));
  } catch (error) {
    if (asset) await cleanupOrphan(asset);
    next(error);
  }
}

function changeStatus(status) {
  return async (req, res, next) => {
    try {
      const blog = await blogService.setBlogStatus(req.params.id, status, actorId(req));
      if (req.flash) req.flash('success', `Blog “${blog.title}” is now ${status}.`);
      res.redirect(redirectTarget(req));
    } catch (error) { next(error); }
  };
}

module.exports = {
  create,
  update,
  publish: changeStatus('published'),
  draft: changeStatus('draft'),
  archive: changeStatus('archived'),
};
