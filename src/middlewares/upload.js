const multer = require('multer');
const path = require('path');
const { env } = require('../config/env');

const ALLOWED_MIME_EXTENSIONS = {
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/png': new Set(['.png']),
  'image/webp': new Set(['.webp']),
  'application/pdf': new Set(['.pdf']),
};

const upload = multer({
  storage: multer.memoryStorage(),
  // Memory storage is intentionally bounded. These limits constrain both file
  // buffers and multipart metadata so malformed/high-cardinality uploads cannot
  // consume the process while the file is being validated.
  limits: {
    fileSize: env.cloudinary.maxUploadSizeMb * 1024 * 1024,
    files: 2,
    fields: 100,
    parts: 102,
    fieldNameSize: 100,
    fieldSize: 256 * 1024,
    headerPairs: 200,
  },
  fileFilter(req, file, cb) {
    const extensions = ALLOWED_MIME_EXTENSIONS[file.mimetype];
    const extension = path.extname(file.originalname || '').toLowerCase();
    const ok = Boolean(extensions?.has(extension));
    if (ok) return cb(null, true);
    const error = new Error('Unsupported file type');
    error.status = 415;
    return cb(error, false);
  },
});

module.exports = upload;
