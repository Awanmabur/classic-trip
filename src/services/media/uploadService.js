const { env } = require('../../config/env');
const { uploadBuffer } = require('./cloudinaryService');

const folders = {
  companyLogo: `${env.cloudinary.folder}/companies/logos`,
  companyCover: `${env.cloudinary.folder}/companies/covers`,
  companyDocument: `${env.cloudinary.folder}/companies/documents`,
  busListing: `${env.cloudinary.folder}/listings/buses`,
  hotelListing: `${env.cloudinary.folder}/listings/hotels`,
  listingMedia: `${env.cloudinary.folder}/listings/general`,
  blog: `${env.cloudinary.folder}/blogs`,
  ticket: `${env.cloudinary.folder}/tickets`,
};

async function uploadMedia(file, target = 'blog') {
  if (!file || !file.buffer) throw new Error('No file buffer provided');
  const maxBytes = env.cloudinary.maxUploadSizeMb * 1024 * 1024;
  if (file.size > maxBytes) throw new Error(`File exceeds ${env.cloudinary.maxUploadSizeMb}MB upload limit`);
  return uploadBuffer(file.buffer, folders[target] || folders.blog, { resourceType: target.includes('Document') || target === 'ticket' ? 'auto' : 'image' });
}

module.exports = { uploadMedia, folders };
