'use strict';

// Keep the physical files private to the resolver. Seeded articles are rendered
// through /media/blog/:slug so old immutable/static/service-worker cache entries
// can never make a valid bundled image appear missing after an upgrade.
const { SEEDED_BLOG_IMAGE_FILES, SEEDED_BLOG_IMAGES, isLegacySeedBlogUrl } = require('./seedMedia');
const { mediaUrl } = require('./mediaUrl');

function text(value) { return String(value || '').trim(); }

function isSeedPlaceholderImage(value) {
  const image = text(value);
  return !image
    || /(?:launch-lockup|logo-symbol)/i.test(image)
    || /^\/images\/operators\//i.test(image)
    || /^\/images\/blogs\/(?:bus-seat-booking|v1644-|v1645-)/i.test(image);
}

function resolveBlogImage(blog = {}) {
  const slug = text(blog.slug);
  const current = mediaUrl(blog.media) || mediaUrl(blog.image) || mediaUrl(blog.coverImage);
  const seeded = SEEDED_BLOG_IMAGES[slug] || '';
  if (seeded && (isSeedPlaceholderImage(current) || current === SEEDED_BLOG_IMAGE_FILES[slug] || isLegacySeedBlogUrl(slug, current))) return seeded;
  return current || seeded;
}

function withResolvedBlogImage(blog = {}) {
  if (!blog || typeof blog !== 'object') return blog;
  return { ...blog, image: resolveBlogImage(blog) };
}

module.exports = {
  SEEDED_BLOG_IMAGE_FILES,
  SEEDED_BLOG_IMAGES,
  isSeedPlaceholderImage,
  resolveBlogImage,
  withResolvedBlogImage,
};
