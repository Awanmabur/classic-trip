'use strict';

const blogService = require('../../services/content/blogService');

function redirectTarget(req) {
  return String(req.originalUrl || '').startsWith('/content/')
    ? '/content/dashboard/blogs'
    : '/admin/blogs';
}

function actorId(req) {
  return req.session?.user?.id || req.user?.id || 'admin';
}

async function create(req, res, next) {
  try {
    const blog = await blogService.createBlog(req.body, actorId(req));
    if (req.flash) req.flash('success', `Blog “${blog.title}” created.`);
    res.redirect(redirectTarget(req));
  } catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    const blog = await blogService.updateBlog(req.params.id, req.body, actorId(req));
    if (req.flash) req.flash('success', `Blog “${blog.title}” updated.`);
    res.redirect(redirectTarget(req));
  } catch (error) { next(error); }
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
