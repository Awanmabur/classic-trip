'use strict';

const contentRepository = require('../../repositories/domain/contentRepository');
const dashboardSnapshotService = require('../dashboard/dashboardSnapshotService');
const { nextId } = require('../data/idService');
const toSlug = require('../../utils/slugify');

const BLOG_STATUSES = new Set(['draft', 'published', 'archived']);

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function cleanMultiline(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function normalizeStatus(value, fallback = 'draft') {
  const status = cleanText(value).toLowerCase();
  return BLOG_STATUSES.has(status) ? status : fallback;
}

async function invalidateContentDashboards() {
  dashboardSnapshotService.invalidate('admin');
  dashboardSnapshotService.invalidate('content');
}

async function findBlog(identifier) {
  const key = cleanText(identifier);
  if (!key) return null;
  return contentRepository.blogs.findOne({ $or: [{ id: key }, { slug: key }] });
}

async function blogOrThrow(identifier) {
  const blog = await findBlog(identifier);
  if (!blog) {
    const error = new Error('Blog post not found');
    error.status = 404;
    throw error;
  }
  return blog;
}

async function uniqueSlug(title, requestedSlug = '', currentId = '') {
  const base = toSlug(cleanText(requestedSlug || title)) || `classic-trip-guide-${Date.now()}`;
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await contentRepository.blogs.findOne({ slug: candidate });
    if (!existing || String(existing.id || existing._id) === String(currentId)) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function applyStatusDates(blog, nextStatus) {
  blog.status = nextStatus;
  if (nextStatus === 'published' && !blog.publishedAt) blog.publishedAt = new Date().toISOString();
  if (nextStatus !== 'published') blog.publishedAt = null;
}

async function createBlog(payload = {}, actorId = '') {
  const title = cleanText(payload.title);
  if (!title) {
    const error = new Error('Blog title is required');
    error.status = 422;
    throw error;
  }
  const id = await nextId('blog');
  const status = normalizeStatus(payload.status, 'draft');
  const blog = {
    id,
    slug: await uniqueSlug(title, payload.slug),
    tag: cleanText(payload.tag || 'Guide'),
    title,
    excerpt: cleanText(payload.excerpt),
    body: cleanMultiline(payload.body),
    image: cleanText(payload.image),
    imageAlt: cleanText(payload.imageAlt || `${title} cover image`),
    status,
    publishedAt: null,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  applyStatusDates(blog, status);
  await contentRepository.blogs.save(blog, { id });
  await invalidateContentDashboards();
  return blog;
}

async function updateBlog(identifier, payload = {}, actorId = '') {
  const blog = await blogOrThrow(identifier);
  const title = cleanText(payload.title || blog.title);
  if (!title) {
    const error = new Error('Blog title is required');
    error.status = 422;
    throw error;
  }
  blog.title = title;
  blog.slug = await uniqueSlug(title, payload.slug || blog.slug, blog.id || blog._id);
  blog.tag = cleanText(payload.tag ?? blog.tag) || 'Guide';
  blog.excerpt = cleanText(payload.excerpt ?? blog.excerpt);
  blog.body = cleanMultiline(payload.body ?? blog.body);
  blog.image = cleanText(payload.image ?? blog.image);
  blog.imageAlt = cleanText(payload.imageAlt ?? blog.imageAlt) || `${title} cover image`;
  if (payload.status) applyStatusDates(blog, normalizeStatus(payload.status, blog.status || 'draft'));
  blog.updatedBy = actorId;
  blog.updatedAt = new Date().toISOString();
  await contentRepository.blogs.save(blog, { id: blog.id });
  await invalidateContentDashboards();
  return blog;
}

async function setBlogStatus(identifier, status, actorId = '') {
  const blog = await blogOrThrow(identifier);
  applyStatusDates(blog, normalizeStatus(status, blog.status || 'draft'));
  blog.updatedBy = actorId;
  blog.updatedAt = new Date().toISOString();
  await contentRepository.blogs.save(blog, { id: blog.id });
  await invalidateContentDashboards();
  return blog;
}

async function ensureBlog(payload = {}) {
  const existing = payload.id || payload.slug ? await findBlog(payload.id || payload.slug) : null;
  if (existing) return existing;
  return createBlog({ ...payload, title: payload.title || 'Classic Trip guide' }, payload.createdBy || 'seed');
}

function mediaMatches(media = {}, publicId = '') {
  const key = cleanText(publicId);
  if (!key) return false;
  return [media.publicId, media.public_id, media.url, media.secureUrl, media.id]
    .some((value) => cleanText(value) === key);
}

function normalizeMedia(asset = {}, metadata = {}) {
  const url = cleanText(asset.secureUrl || asset.url || '');
  return {
    id: cleanText(asset.id || asset.publicId || asset.public_id || `blog-media-${Date.now()}`),
    url,
    secureUrl: url,
    publicId: cleanText(asset.publicId || asset.public_id || url),
    alt: cleanText(metadata.alt || asset.alt || metadata.title || 'Classic Trip guide image'),
    label: cleanText(metadata.label || asset.label || metadata.title || 'Blog image'),
    width: asset.width,
    height: asset.height,
    format: asset.format,
    resourceType: cleanText(asset.resourceType || asset.resource_type || 'image'),
    target: 'blog',
    uploadedBy: cleanText(metadata.uploadedBy || ''),
    uploadedAt: metadata.uploadedAt || new Date().toISOString(),
  };
}

async function attachMedia(blogId, asset, metadata = {}) {
  const blog = await blogOrThrow(blogId);
  const media = normalizeMedia(asset, { ...metadata, title: blog.title });
  Object.assign(blog, { media, image: media.url, imageAlt: media.alt, updatedAt: new Date().toISOString() });
  await contentRepository.blogs.save(blog, { id: blog.id });
  await invalidateContentDashboards();
  return { target: 'blog', blog, media };
}

async function removeMedia(blogId, publicId) {
  const blog = await blogOrThrow(blogId);
  const media = blog.media || (blog.image ? { url: blog.image, secureUrl: blog.image, publicId: blog.image, resourceType: 'image' } : null);
  if (!media || (publicId && !mediaMatches(media, publicId))) {
    const error = new Error('Blog media not found');
    error.status = 404;
    throw error;
  }
  Object.assign(blog, { media: null, image: '', imageAlt: '', updatedAt: new Date().toISOString() });
  await contentRepository.blogs.save(blog, { id: blog.id });
  await invalidateContentDashboards();
  return { target: 'blog', blog, media };
}

module.exports = {
  BLOG_STATUSES,
  createBlog,
  updateBlog,
  setBlogStatus,
  ensureBlog,
  attachMedia,
  removeMedia,
  findBlog,
};
