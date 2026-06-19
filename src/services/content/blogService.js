const store = require('../data/persistentStore');
const { mongoose } = require('../../config/db');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

async function upsertBlog(blog) {
  if (!mongoReady()) return;
  require('../../models/BlogPost');
  const BlogPost = mongoose.model('BlogPost');
  await BlogPost.updateOne({ id: blog.id }, { $set: blog }, { upsert: true, runValidators: true });
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function nextId() {
  const rows = Array.isArray(store.state.blogs) ? store.state.blogs : [];
  let index = rows.length + 1;
  let id = `blog-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `blog-${index}`;
  }
  return id;
}

function ensureBlogs() {
  if (!Array.isArray(store.state.blogs)) store.state.blogs = [];
}

function findBlog(identifier) {
  ensureBlogs();
  const key = cleanText(identifier).toLowerCase();
  return store.state.blogs.find((blog) => [blog.id, blog.slug].some((value) => cleanText(value).toLowerCase() === key));
}

function blogOrThrow(identifier) {
  const blog = findBlog(identifier);
  if (!blog) {
    const error = new Error('Blog post not found');
    error.status = 404;
    throw error;
  }
  return blog;
}

function mediaMatches(media = {}, publicId = '') {
  const key = cleanText(publicId);
  if (!key) return false;
  return [media.publicId, media.public_id, media.url, media.secureUrl, media.id].some((value) => cleanText(value) === key);
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

async function ensureBlog(payload = {}) {
  ensureBlogs();
  const existing = payload.id || payload.slug ? findBlog(payload.id || payload.slug) : null;
  if (existing) return existing;
  const title = cleanText(payload.title || 'Classic Trip guide');
  const slug = cleanText(payload.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) || nextId();
  const blog = {
    id: payload.id || nextId(),
    slug,
    tag: cleanText(payload.tag || 'Guide'),
    title,
    excerpt: cleanText(payload.excerpt || ''),
    body: cleanText(payload.body || ''),
    image: cleanText(payload.image || ''),
    status: cleanText(payload.status || 'draft'),
    publishedAt: payload.publishedAt || null,
    createdAt: new Date().toISOString(),
  };
  store.state.blogs.push(blog);
  await upsertBlog(blog);
  return blog;
}

async function attachMedia(blogId, asset, metadata = {}) {
  const blog = blogOrThrow(blogId);
  const media = normalizeMedia(asset, { ...metadata, title: blog.title });
  blog.media = media;
  blog.image = media.url;
  blog.imageAlt = media.alt;
  blog.updatedAt = new Date().toISOString();
  await upsertBlog(blog);
  return { target: 'blog', blog, media };
}

async function removeMedia(blogId, publicId) {
  const blog = blogOrThrow(blogId);
  const media = blog.media || (blog.image ? { url: blog.image, secureUrl: blog.image, publicId: blog.image, resourceType: 'image' } : null);
  if (!media || (publicId && !mediaMatches(media, publicId))) {
    const error = new Error('Blog media not found');
    error.status = 404;
    throw error;
  }
  blog.media = null;
  blog.image = '';
  blog.imageAlt = '';
  blog.updatedAt = new Date().toISOString();
  await upsertBlog(blog);
  return { target: 'blog', blog, media };
}

module.exports = {
  ensureBlog,
  attachMedia,
  removeMedia,
  findBlog,
};
