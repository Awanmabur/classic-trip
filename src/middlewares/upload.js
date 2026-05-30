const multer = require('multer');
const { env } = require('../config/env');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.cloudinary.maxUploadSizeMb * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = /image\/(jpeg|png|webp)|application\/pdf/.test(file.mimetype);
    cb(ok ? null : new Error('Unsupported file type'), ok);
  },
});

module.exports = upload;
