const cloudinary = require('../../config/cloudinary');

async function uploadBuffer(buffer, folder, options = {}) {
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
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

module.exports = { uploadBuffer, deleteAsset };
