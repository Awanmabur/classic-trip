let slugifyPackage = null;
try { slugifyPackage = require('slugify'); } catch (error) { slugifyPackage = null; }

module.exports = function toSlug(value) {
  const input = String(value || '');
  if (slugifyPackage) return slugifyPackage(input, { lower: true, strict: true, trim: true });
  return input.toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
};
