'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDb, mongoose } = require('../src/config/db');
const BlogPost = require('../src/models/BlogPost');
const Listing = require('../src/models/Listing');
const Vehicle = require('../src/models/Vehicle');
const uploadService = require('../src/services/media/uploadService');
const { isCloudinaryUrl, mediaUrl } = require('../src/utils/mediaUrl');
const {
  SEEDED_BLOG_IMAGE_FILES,
  SEEDED_OPERATOR_IMAGE_FILES,
  SEEDED_BLOG_IMAGES,
  SEEDED_OPERATOR_IMAGES,
  isLegacySeedBlogUrl,
  isLegacySeedOperatorUrl,
} = require('../src/utils/seedMedia');

const apply = process.argv.includes('--apply');
const ROOT = path.join(__dirname, '..', 'public');

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function localFile(publicPath) {
  return path.join(ROOT, String(publicPath || '').replace(/^\//, ''));
}

async function uploadBundled(publicPath, target, label) {
  const filePath = localFile(publicPath);
  const buffer = fs.readFileSync(filePath);
  return uploadService.uploadMedia({
    buffer,
    size: buffer.length,
    mimetype: mimeFor(filePath),
    originalname: path.basename(filePath),
  }, target, label);
}

function seededUrl(value) {
  const url = mediaUrl(value);
  return /^\/media\/(?:blog|operator)\//.test(url) || /^\/images\/(?:blogs|operators)\//.test(url);
}

async function migrateBlogs(summary) {
  for (const [slug, sourcePath] of Object.entries(SEEDED_BLOG_IMAGE_FILES)) {
    const blog = await BlogPost.findOne({ slug });
    if (!blog) { summary.blogs.missing += 1; continue; }
    const current = mediaUrl(blog.media) || mediaUrl(blog.image);
    if (isCloudinaryUrl(current)) { summary.blogs.alreadyCloudinary += 1; continue; }
    if (!seededUrl(current) && current && !isLegacySeedBlogUrl(slug, current)) { summary.blogs.customPreserved += 1; continue; }
    summary.blogs.pending += 1;
    if (!apply) continue;
    const asset = await uploadBundled(sourcePath, 'blog', blog.title);
    blog.media = {
      id: asset.publicId,
      url: asset.secureUrl || asset.url,
      secureUrl: asset.secureUrl || asset.url,
      publicId: asset.publicId,
      width: asset.width,
      height: asset.height,
      format: asset.format,
      resourceType: asset.resourceType || 'image',
      alt: blog.imageAlt || `${blog.title} cover image`,
      label: blog.title,
      target: 'blog',
      status: 'approved',
      uploadedBy: 'seed-media-migration',
      uploadedAt: new Date(),
    };
    blog.image = asset.secureUrl || asset.url;
    await blog.save();
    summary.blogs.migrated += 1;
  }
}

async function migrateOperators(summary) {
  for (const [key, sourcePath] of Object.entries(SEEDED_OPERATOR_IMAGE_FILES)) {
    const listing = await Listing.findOne({
      serviceType: 'bus',
      $or: [{ companySlug: key }, { slug: `${key}-bus` }],
    });
    if (!listing) { summary.operators.missing += 1; continue; }
    const current = mediaUrl(listing.media) || mediaUrl(listing.img);
    if (isCloudinaryUrl(current)) { summary.operators.alreadyCloudinary += 1; continue; }
    if (!seededUrl(current) && current && !isLegacySeedOperatorUrl(key, current)) { summary.operators.customPreserved += 1; continue; }
    summary.operators.pending += 1;
    if (!apply) continue;

    const asset = await uploadBundled(sourcePath, 'busListing', listing.title);
    const media = {
      id: asset.publicId,
      url: asset.secureUrl || asset.url,
      secureUrl: asset.secureUrl || asset.url,
      publicId: asset.publicId,
      width: asset.width,
      height: asset.height,
      format: asset.format,
      resourceType: asset.resourceType || 'image',
      alt: `${listing.title} coach`,
      label: `${listing.title} bus image`,
      target: 'busListing',
      status: 'approved',
      uploadedBy: 'seed-media-migration',
      uploadedAt: new Date(),
    };
    const preserved = (listing.media || []).filter((item) => !seededUrl(item) && !isLegacySeedOperatorUrl(key, mediaUrl(item)));
    listing.media = [media, ...preserved];
    listing.serviceDetails = { ...(listing.serviceDetails || {}), realBusImage: media.url, mediaProvider: 'cloudinary' };
    await listing.save();

    const vehicles = await Vehicle.find({ companyId: listing.companyId, listingId: listing.id, status: { $ne: 'archived' } });
    for (const vehicle of vehicles) {
      const vehicleCurrent = mediaUrl(vehicle.media);
      if (vehicleCurrent && !seededUrl(vehicleCurrent) && !isCloudinaryUrl(vehicleCurrent) && !isLegacySeedOperatorUrl(key, vehicleCurrent)) continue;
      if (isCloudinaryUrl(vehicleCurrent)) continue;
      const vehicleMedia = { ...media, id: `${asset.publicId}:vehicle:${vehicle.id}`, target: 'vehiclePhoto', label: `${vehicle.name || listing.title} photo` };
      const vehiclePreserved = (vehicle.media || []).filter((item) => !seededUrl(item) && !isLegacySeedOperatorUrl(key, mediaUrl(item)));
      vehicle.media = [vehicleMedia, ...vehiclePreserved];
      await vehicle.save();
      summary.operators.vehiclesUpdated += 1;
    }
    summary.operators.migrated += 1;
  }
}

async function main() {
  await connectDb({ processName: 'seed-media-cloudinary' });
  if (apply && !uploadService.isConfigured()) {
    const error = new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET before running --apply.');
    error.code = 'MEDIA_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    fallbackMedia: { blogs: SEEDED_BLOG_IMAGES, operators: SEEDED_OPERATOR_IMAGES },
    blogs: { pending: 0, migrated: 0, alreadyCloudinary: 0, customPreserved: 0, missing: 0 },
    operators: { pending: 0, migrated: 0, vehiclesUpdated: 0, alreadyCloudinary: 0, customPreserved: 0, missing: 0 },
  };
  await migrateBlogs(summary);
  await migrateOperators(summary);
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => {}); });
