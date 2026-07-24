const contentRepository = require('../../repositories/domain/contentRepository');
const { nextId } = require('../data/idService');
function cleanText(value) { return String(value || '').replace(/<[^>]*>/g, '').trim(); }
async function findBlog(identifier) {
  const key = cleanText(identifier);
  if (!key) return null;
  return contentRepository.blogs.findOne({ $or: [{ id: key }, { slug: key }] });
}
async function blogOrThrow(identifier) {
  const blog = await findBlog(identifier);
  if (!blog) { const error = new Error('Blog post not found'); error.status = 404; throw error; }
  return blog;
}
function mediaMatches(media = {}, publicId = '') {
  const key = cleanText(publicId); if (!key) return false;
  return [media.publicId, media.public_id, media.url, media.secureUrl, media.id].some((value) => cleanText(value) === key);
}
function normalizeMedia(asset = {}, metadata = {}) {
  const url = cleanText(asset.secureUrl || asset.url || '');
  return { id: cleanText(asset.id || asset.publicId || asset.public_id || `blog-media-${Date.now()}`), url, secureUrl: url, publicId: cleanText(asset.publicId || asset.public_id || url), alt: cleanText(metadata.alt || asset.alt || metadata.title || 'Classic Trip guide image'), label: cleanText(metadata.label || asset.label || metadata.title || 'Blog image'), width: asset.width, height: asset.height, format: asset.format, resourceType: cleanText(asset.resourceType || asset.resource_type || 'image'), target: 'blog', uploadedBy: cleanText(metadata.uploadedBy || ''), uploadedAt: metadata.uploadedAt || new Date().toISOString() };
}
async function ensureBlog(payload = {}) {
  const existing = payload.id || payload.slug ? await findBlog(payload.id || payload.slug) : null;
  if (existing) return existing;
  const title = cleanText(payload.title || 'Classic Trip guide');
  const id = payload.id || await nextId('blog');
  const slug = cleanText(payload.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) || id;
  const duplicate = await contentRepository.blogs.findOne({ slug });
  if (duplicate) { const error = new Error('A blog post with this slug already exists'); error.status = 409; throw error; }
  const blog = { id, slug, tag: cleanText(payload.tag || 'Guide'), title, excerpt: cleanText(payload.excerpt || ''), body: cleanText(payload.body || ''), image: cleanText(payload.image || ''), status: cleanText(payload.status || 'draft'), publishedAt: payload.publishedAt || null, createdAt: new Date().toISOString() };
  await contentRepository.blogs.save(blog, { id: blog.id });
  return blog;
}
async function attachMedia(blogId, asset, metadata = {}) {
  const blog = await blogOrThrow(blogId); const media = normalizeMedia(asset, { ...metadata, title: blog.title });
  Object.assign(blog, { media, image: media.url, imageAlt: media.alt, updatedAt: new Date().toISOString() });
  await contentRepository.blogs.save(blog, { id: blog.id }); return { target: 'blog', blog, media };
}
async function removeMedia(blogId, publicId) {
  const blog = await blogOrThrow(blogId); const media = blog.media || (blog.image ? { url: blog.image, secureUrl: blog.image, publicId: blog.image, resourceType: 'image' } : null);
  if (!media || (publicId && !mediaMatches(media, publicId))) { const error = new Error('Blog media not found'); error.status = 404; throw error; }
  Object.assign(blog, { media: null, image: '', imageAlt: '', updatedAt: new Date().toISOString() });
  await contentRepository.blogs.save(blog, { id: blog.id }); return { target: 'blog', blog, media };
}
module.exports = { ensureBlog, attachMedia, removeMedia, findBlog };
