#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { mediaUrl, isCloudinaryUrl } = require('../src/utils/mediaUrl');
const {
  SEEDED_BLOG_IMAGE_FILES,
  SEEDED_OPERATOR_IMAGE_FILES,
  SEEDED_BLOG_IMAGES,
  SEEDED_OPERATOR_IMAGES,
} = require('../src/utils/seedMedia');

const withDb = process.argv.includes('--db');
const root = path.resolve(__dirname, '..');

function loadDotEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function configuredValue(name) {
  const value = String(process.env[name] || '').trim();
  if (!value || /^your_/i.test(value) || /^(changeme|replace_me)$/i.test(value)) return '';
  return value;
}

loadDotEnv();

function provider(value) {
  const url = mediaUrl(value);
  if (!url) return 'missing';
  if (isCloudinaryUrl(url)) return 'cloudinary';
  if (/^\/media\/(?:blog|operator)\//.test(url)) return 'stable-local';
  if (/^\/images\//.test(url)) return 'local-static';
  if (/^https:\/\//.test(url)) return 'external-https';
  return 'other';
}

function localStatus(files) {
  return Object.fromEntries(Object.entries(files).map(([key, publicPath]) => {
    const absolute = path.join(root, 'public', publicPath.replace(/^\//, ''));
    return [key, {
      publicPath,
      exists: fs.existsSync(absolute),
      bytes: fs.existsSync(absolute) ? fs.statSync(absolute).size : 0,
    }];
  }));
}

async function dbStatus() {
  const { connectDb, mongoose } = require('../src/config/db');
  const BlogPost = require('../src/models/BlogPost');
  const Listing = require('../src/models/Listing');
  const Vehicle = require('../src/models/Vehicle');
  await connectDb({ processName: 'media-doctor' });
  try {
    const blogSlugs = Object.keys(SEEDED_BLOG_IMAGES);
    const operatorKeys = Object.keys(SEEDED_OPERATOR_IMAGES);
    const blogs = await BlogPost.find({ slug: { $in: blogSlugs } }).lean();
    const listings = await Listing.find({
      serviceType: 'bus',
      $or: [
        { companySlug: { $in: operatorKeys } },
        { slug: { $in: operatorKeys.map((key) => `${key}-bus`) } },
      ],
    }).lean();
    const listingIds = listings.map((row) => row.id).filter(Boolean);
    const vehicles = listingIds.length ? await Vehicle.find({ listingId: { $in: listingIds }, status: { $ne: 'archived' } }).lean() : [];
    return {
      blogs: blogs.map((row) => ({ slug: row.slug, url: mediaUrl(row.media) || mediaUrl(row.image), provider: provider(row.media || row.image) })),
      busListings: listings.map((row) => ({ id: row.id, slug: row.slug, companySlug: row.companySlug, url: mediaUrl(row.media) || mediaUrl(row.img), provider: provider(row.media || row.img) })),
      vehicles: vehicles.map((row) => ({ id: row.id, listingId: row.listingId, url: mediaUrl(row.media), provider: provider(row.media) })),
    };
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

async function main() {
  const report = {
    cloudinary: {
      configured: Boolean(configuredValue('CLOUDINARY_CLOUD_NAME') && configuredValue('CLOUDINARY_API_KEY') && configuredValue('CLOUDINARY_API_SECRET')),
      cloudNamePresent: Boolean(configuredValue('CLOUDINARY_CLOUD_NAME')),
      apiKeyPresent: Boolean(configuredValue('CLOUDINARY_API_KEY')),
      apiSecretPresent: Boolean(configuredValue('CLOUDINARY_API_SECRET')),
      folder: process.env.CLOUDINARY_FOLDER || 'classic-trip',
    },
    bundled: {
      blogs: localStatus(SEEDED_BLOG_IMAGE_FILES),
      operators: localStatus(SEEDED_OPERATOR_IMAGE_FILES),
    },
    stableUrls: {
      blogs: SEEDED_BLOG_IMAGES,
      operators: SEEDED_OPERATOR_IMAGES,
    },
  };
  if (withDb) report.database = await dbStatus();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`Media doctor failed: ${error.message}`);
  process.exitCode = 1;
});
