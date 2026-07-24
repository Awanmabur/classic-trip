const cloudinary = require('../../config/cloudinary');
const { env } = require('../../config/env');

function isConfigured() {
  return Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);
}

function requireConfiguration(action) {
  if (isConfigured()) return;
  const error = new Error(`Media ${action} is unavailable because Cloudinary is not configured`);
  error.status = 503;
  error.code = 'MEDIA_PROVIDER_NOT_CONFIGURED';
  error.publicMessage = 'Media uploads are unavailable until the storage provider is configured.';
  throw error;
}

async function uploadBuffer(buffer, folder, options = {}) {
  requireConfiguration('upload');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('A non-empty media file is required');
    error.status = 422;
    error.code = 'MEDIA_FILE_REQUIRED';
    throw error;
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
  requireConfiguration('deletion');
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

module.exports = { uploadBuffer, deleteAsset, isConfigured };
