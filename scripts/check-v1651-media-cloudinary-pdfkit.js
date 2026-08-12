#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const seedMedia = require('../src/utils/seedMedia');
const { mediaUrl, resolveMediaUrl } = require('../src/utils/mediaUrl');
let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${label}`);
}

check('release is v1.6.51 or newer', () => assert(/^1\.6\.(?:5[1-9]|[6-9][0-9])$/.test(pkg.version), pkg.version));
check('PDFKit is upgraded off the deprecated jpeg-exif tree', () => {
  assert.strictEqual(pkg.dependencies.pdfkit, '^0.19.1');
  assert.strictEqual(lock.packages['node_modules/pdfkit']?.version, '0.19.1');
  assert(!lock.packages['node_modules/jpeg-exif']);
  assert(!JSON.stringify(lock.packages['node_modules/pdfkit'] || {}).includes('jpeg-exif'));
  assert(!lock.packages['node_modules/crypto-js']);
});
check('PDFKit replacement dependency tree is locked', () => {
  for (const name of ['@noble/ciphers', '@noble/hashes', 'fontkit', 'js-md5', 'linebreak', 'png-js']) {
    assert(lock.packages[`node_modules/${name}`], `Missing ${name}`);
  }
});
check('media resolver prefers secureUrl and accepts stable local media', () => {
  assert.strictEqual(mediaUrl({ url: 'https://example.invalid/old.jpg', secureUrl: 'https://res.cloudinary.com/demo/image/upload/new.jpg' }), 'https://res.cloudinary.com/demo/image/upload/new.jpg');
  assert.strictEqual(resolveMediaUrl('', { secureUrl: '/media/operator/test' }), '/media/operator/test');
  assert.strictEqual(mediaUrl({ secureUrl: 'http://unsafe.example/old.jpg', url: '/media/operator/fallback' }), '/media/operator/fallback');
});
check('all seeded blog and operator source images are bundled', () => {
  for (const rel of [...Object.values(seedMedia.SEEDED_BLOG_IMAGE_FILES), ...Object.values(seedMedia.SEEDED_OPERATOR_IMAGE_FILES)]) {
    const file = path.join(root, 'public', rel.replace(/^\//, ''));
    assert(fs.existsSync(file), rel);
    assert(fs.statSync(file).size > 1000, rel);
  }
});
check('stable self-hosted media endpoints exist for seeded blogs and buses', () => {
  assert.strictEqual(Object.keys(seedMedia.SEEDED_BLOG_IMAGES).length, 7);
  assert.strictEqual(Object.keys(seedMedia.SEEDED_OPERATOR_IMAGES).length, 6);
  assert(Object.values(seedMedia.SEEDED_BLOG_IMAGES).every((url) => url.startsWith('/media/blog/')));
  assert(Object.values(seedMedia.SEEDED_OPERATOR_IMAGES).every((url) => url.startsWith('/media/operator/')));
  const routes = read('src/routes/web/public.js');
  assert(routes.includes("router.get('/media/blog/:slug', mediaController.blog)"));
  assert(routes.includes("router.get('/media/operator/:key', mediaController.operator)"));
});
check('seed media endpoints bypass stale caches', () => {
  const controller = read('src/controllers/public/mediaController.js');
  assert(controller.includes('no-cache, no-store, must-revalidate'));
  assert(controller.includes("res.sendFile"));
  const sw = read('public/sw.js');
  assert(sw.includes(`classic-trip-static-v${pkg.version}`));
  assert(!sw.includes('/media/blog/'));
  assert(!sw.includes('/media/operator/'));
});
check('blog resolver prefers persisted Cloudinary media over stale image field', () => {
  const source = read('src/utils/blogImage.js');
  assert(source.includes('mediaUrl(blog.media) || mediaUrl(blog.image)'));
});
check('public listing cards and details use shared media resolver', () => {
  assert(read('src/views/partials/listing-card.ejs').includes('resolveMediaUrl(listing.img, listing.image, listing.coverImage, listing.media)'));
  assert(read('src/views/pages/listing-details.ejs').includes('resolveMediaUrl(listing.img, listing.image, listing.coverImage, listing.media)'));
  assert(read('src/services/customer/customerService.js').includes('resolveMediaUrl(listing.img, listing.image, listing.media)'));
});
check('company logos/covers and marketplace media use secure-first resolver', () => {
  const catalog = read('src/services/marketplace/catalogService.js');
  assert(catalog.includes('url: resolveListingImage(listing, company, item)'));
  assert(catalog.includes('logo: { url: mediaUrl(company.logo) }'));
  assert(read('src/views/pages/companies.ejs').includes('mediaUrl(company.coverImage)'));
  assert(read('src/views/pages/company-profile.ejs').includes('mediaUrl(company.logo)'));
});
check('homepage client accepts secureUrl media', () => {
  assert(read('public/js/home.js').includes("item.media?.[0]?.secureUrl || item.media?.[0]?.url"));
});
check('blog create/edit accepts validated file uploads', () => {
  const routes = read('src/routes/web/admin.js');
  const controller = read('src/controllers/admin/blogController.js');
  const view = read('src/views/dashboards/shared/sections/blogs.ejs');
  assert(routes.includes("upload.single('imageFile'), requireCsrfToken, blogController.create"));
  assert(routes.includes("upload.single('imageFile'), requireCsrfToken, blogController.update"));
  assert(controller.includes("uploadService.uploadMedia(req.file, 'blog')"));
  assert(view.includes('name="imageFile"'));
  assert(view.includes('multipart/form-data'));
});
check('Cloudinary upload service has folders for all major image targets', () => {
  const source = read('src/services/media/uploadService.js');
  for (const target of ['companyLogo', 'companyCover', 'vehiclePhoto', 'busListing', 'hotelListing', 'listingMedia', 'blog', 'hotelPropertyMedia', 'roomTypeMedia', 'roomUnitMedia']) {
    assert(source.includes(`${target}:`), target);
  }
  assert(source.includes('assertFileSignature(file)'));
});
check('CSP explicitly allows Cloudinary images', () => {
  const app = read('src/app.js');
  assert(app.includes("'https://res.cloudinary.com'"));
  assert(app.includes("'https://*.cloudinary.com'"));
});
check('seed script persists stable media URLs rather than fragile direct image paths', () => {
  const source = read('scripts/seed-launch-seo-operators.js');
  assert(source.includes('SEEDED_OPERATOR_IMAGES: OPERATOR_IMAGES'));
  assert(source.includes('SEEDED_BLOG_IMAGES: BLOG_IMAGES'));
});
check('Cloudinary migration exists and preserves custom media', () => {
  const source = read('scripts/migrate-seeded-media-cloudinary.js');
  assert(source.includes('isLegacySeedBlogUrl'));
  assert(source.includes('isLegacySeedOperatorUrl'));
  assert(source.includes('customPreserved'));
  assert(source.includes("uploadService.uploadMedia"));
  assert(source.includes('Cloudinary is not configured'));
  assert(pkg.scripts['migrate:seeded-media']);
  assert(pkg.scripts['migrate:seeded-media:dry']);
});
check('no deprecated jpeg-exif reference remains in package or lock files', () => {
  assert(!read('package.json').includes('jpeg-exif'));
  assert(!read('package-lock.json').includes('jpeg-exif'));
});
check('all current semantic asset versions match the current package version', () => {
  const roots = ['src/views', 'public/sw.js'];
  for (const entry of roots) {
    const stat = fs.statSync(path.join(root, entry));
    const files = stat.isDirectory()
      ? fs.readdirSync(path.join(root, entry), { recursive: true }).filter((name) => /\.(?:ejs|js|css)$/.test(name)).map((name) => path.join(entry, name))
      : [entry];
    for (const file of files) {
      const source = read(file);
      assert(!source.includes('v=1.6.50'), file);
      if (file === 'public/sw.js') assert(source.includes(`classic-trip-static-v${pkg.version}`));
    }
  }
});

console.log(`\n${passed}/18 v1.6.51+ media/Cloudinary/PDFKit regression checks passed.`);
