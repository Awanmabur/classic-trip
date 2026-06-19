const crypto = require('crypto');
const cloudinary = require('../../config/cloudinary');
const { env } = require('../../config/env');

function isConfigured() {
  return Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);
}

function devAsset(buffer, folder, options = {}) {
  const originalName = options.originalFilename || options.filename || 'upload.bin';
  const extension = String(originalName).split('.').pop() || 'bin';
  const digest = crypto
    .createHash('sha1')
    .update(buffer || Buffer.alloc(0))
    .update(folder)
    .update(originalName)
    .digest('hex')
    .slice(0, 16);
  const publicId = `${folder}/${Date.now()}-${digest}`;
  const mimetype = String(options.mimetype || '');
  const resourceType = options.resourceType === 'auto'
    ? (mimetype.startsWith('image/') ? 'image' : 'raw')
    : (options.resourceType || (mimetype.startsWith('image/') ? 'image' : 'raw'));
  const secureUrl = `https://res.cloudinary.com/classic-trip-dev/${resourceType}/upload/${publicId}.${extension}`;
  return {
    url: secureUrl,
    secureUrl,
    publicId,
    width: mimetype.startsWith('image/') ? 1 : undefined,
    height: mimetype.startsWith('image/') ? 1 : undefined,
    format: extension.toLowerCase(),
    resourceType,
    fallback: true,
  };
}

async function uploadBuffer(buffer, folder, options = {}) {
  if (!isConfigured()) {
    if (env.isProduction) throw new Error('Cloudinary is not configured for production uploads');
    return devAsset(buffer, folder, options);
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: options.resourceType || 'auto' },
      (error, result) => {
        if (error) return reject(error);
        return resolve({
          url: result.secure_url,
          secureUrl: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format,
          resourceType: result.resource_type,
        });
      }
    );
    stream.end(buffer);
  });
}

async function deleteAsset(publicId, resourceType = 'image') {
  if (!publicId) return { result: 'not_found' };
  if (!isConfigured()) {
    if (env.isProduction) throw new Error('Cloudinary is not configured for production deletes');
    return { result: 'ok', publicId, resourceType, fallback: true };
  }
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

module.exports = { uploadBuffer, deleteAsset, isConfigured };
