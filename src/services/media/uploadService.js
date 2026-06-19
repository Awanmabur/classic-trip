const { env } = require('../../config/env');
const { uploadBuffer, deleteAsset, isConfigured } = require('./cloudinaryService');

const folders = {
  companyLogo: `${env.cloudinary.folder}/companies/logos`,
  companyCover: `${env.cloudinary.folder}/companies/covers`,
  companyDocument: `${env.cloudinary.folder}/companies/documents`,
  companyVerificationDocument: `${env.cloudinary.folder}/companies/verification`,
  vehiclePhoto: `${env.cloudinary.folder}/vehicles/photos`,
  vehicleDocument: `${env.cloudinary.folder}/vehicles/documents`,
  driverDocument: `${env.cloudinary.folder}/drivers/documents`,
  hotelPropertyMedia: `${env.cloudinary.folder}/hotels/properties`,
  roomTypeMedia: `${env.cloudinary.folder}/hotels/room-types`,
  roomUnitMedia: `${env.cloudinary.folder}/hotels/room-units`,
  guestDocument: `${env.cloudinary.folder}/hotels/guest-documents`,
  busListing: `${env.cloudinary.folder}/listings/buses`,
  hotelListing: `${env.cloudinary.folder}/listings/hotels`,
  listingMedia: `${env.cloudinary.folder}/listings/general`,
  blog: `${env.cloudinary.folder}/blogs`,
  ticket: `${env.cloudinary.folder}/tickets`,
};

function resourceTypeFor(file = {}, target = 'blog') {
  if (target === 'ticket' || /Document|Verification/i.test(target)) return 'auto';
  if (String(file.mimetype || '').startsWith('image/')) return 'image';
  return 'auto';
}

async function uploadMedia(file, target = 'blog') {
  if (!file || !file.buffer) throw new Error('No file buffer provided');
  const maxBytes = env.cloudinary.maxUploadSizeMb * 1024 * 1024;
  if (file.size > maxBytes) throw new Error(`File exceeds ${env.cloudinary.maxUploadSizeMb}MB upload limit`);
  return uploadBuffer(file.buffer, folders[target] || folders.blog, {
    resourceType: resourceTypeFor(file, target),
    mimetype: file.mimetype,
    originalFilename: file.originalname,
  });
}

async function deleteMedia(mediaOrPublicId, resourceType = 'image') {
  const publicId = typeof mediaOrPublicId === 'string'
    ? mediaOrPublicId
    : mediaOrPublicId?.publicId || mediaOrPublicId?.public_id;
  const type = typeof mediaOrPublicId === 'string'
    ? resourceType
    : mediaOrPublicId?.resourceType || mediaOrPublicId?.resource_type || resourceType;
  return deleteAsset(publicId, type || 'image');
}

module.exports = { uploadMedia, deleteMedia, folders, isConfigured };
