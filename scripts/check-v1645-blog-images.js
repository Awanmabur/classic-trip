'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const { SEEDED_BLOG_IMAGE_FILES, SEEDED_BLOG_IMAGES, resolveBlogImage } = require('../src/utils/blogImage');
let passed = 0;
function check(name, fn) { try { fn(); passed += 1; console.log(`✓ ${name}`); } catch (error) { console.error(`✗ ${name}`); throw error; } }
check('all seven dedicated blog images exist and are non-empty', () => {
  assert.strictEqual(Object.keys(SEEDED_BLOG_IMAGES).length, 7);
  for (const image of Object.values(SEEDED_BLOG_IMAGE_FILES)) {
    const file = path.join(root, 'public', image.replace(/^\//, ''));
    assert(fs.existsSync(file), image);
    assert(fs.statSync(file).size > 1000, image);
  }
});
check('old logo image resolves to dedicated article art', () => assert(resolveBlogImage({ slug: 'kampala-to-juba-bus-travel-guide', image: '/images/launch-lockup-512.png' }).includes('/media/blog/')));
check('old operator image resolves to dedicated article art', () => assert(resolveBlogImage({ slug: 'kampala-to-juba-bus-travel-guide', image: '/images/operators/bebeto-coach.webp' }).includes('/media/blog/')));
check('super-admin custom remote image remains editable', () => assert.strictEqual(resolveBlogImage({ slug: 'kampala-to-juba-bus-travel-guide', image: 'https://example.com/custom.jpg' }), 'https://example.com/custom.jpg'));
check('home bootstrap resolves blog images server-side', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/marketplace/catalogService.js'), 'utf8');
  assert(source.includes("require('../../utils/blogImage')"));
  assert(source.includes('image: resolveBlogImage(row)'));
});
check('blog index and article resolve old stored image values', () => {
  const source = fs.readFileSync(path.join(root, 'src/controllers/public/blogController.js'), 'utf8');
  assert(source.includes('withResolvedBlogImage'));
  assert(source.includes('resolveBlogImage(blog)'));
});
check('seed upgrades old logo and operator image references through centralized stable media', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/seed-launch-seo-operators.js'), 'utf8');
  const mediaSource = fs.readFileSync(path.join(root, 'src/utils/seedMedia.js'), 'utf8');
  assert(source.includes('SEEDED_BLOG_IMAGES: BLOG_IMAGES'));
  assert(source.includes('SEEDED_OPERATOR_IMAGES: OPERATOR_IMAGES'));
  assert(mediaSource.includes('/images/blogs/v1645-book-bus-online.webp'));
  assert(mediaSource.includes('/images/operators/bebeto-coach.webp'));
});
check('service worker cache is current and seeded blog media bypasses precache', () => {
  const source = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  const version = require('../package.json').version;
  assert(source.includes(`classic-trip-static-v${version}`));
  for (const image of Object.values(SEEDED_BLOG_IMAGE_FILES)) assert(!source.includes(image));
});
console.log(`\n${passed}/8 v1.6.45 blog-image checks passed.`);
