const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { cloudinary, isCloudinaryConfigured } = require("../providers/cloudinary");

const allowedExtensions = new Set(["jpg", "jpeg", "png", "webp"]);

function getExtension(file = {}) {
  return String((file.originalname || "").split(".").pop() || "")
    .trim()
    .toLowerCase();
}

function ensureAllowed(file) {
  const ext = getExtension(file);
  if (!allowedExtensions.has(ext)) {
    const err = new Error("Only jpg/jpeg/png/webp allowed");
    err.statusCode = 400;
    throw err;
  }
  return ext;
}

function sanitizeSegment(segment = "") {
  return String(segment || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join(path.sep);
}

function localUploadsRoot(folder = "classic-trip") {
  return path.join(__dirname, "..", "..", "..", "public", "uploads", sanitizeSegment(folder));
}

function localStorage(folder) {
  return multer.diskStorage({
    destination(_req, _file, cb) {
      const directory = localUploadsRoot(folder);
      fs.mkdirSync(directory, { recursive: true });
      cb(null, directory);
    },
    filename(_req, file, cb) {
      const ext = ensureAllowed(file);
      cb(null, `${Date.now()}-${crypto.randomUUID()}.${ext}`);
    }
  });
}

function cloudinaryStorage(folder) {
  return new CloudinaryStorage({
    cloudinary,
    params: async (_req, file) => {
      const ext = ensureAllowed(file);
      return {
        folder,
        resource_type: "image",
        format: ext
      };
    }
  });
}

function fileFilter(_req, file, cb) {
  try {
    ensureAllowed(file);
    cb(null, true);
  } catch (err) {
    cb(err);
  }
}

function makeUpload(folder = "classic-trip") {
  const storage = isCloudinaryConfigured
    ? cloudinaryStorage(folder)
    : localStorage(folder);

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 3 * 1024 * 1024 }
  });
}

module.exports = { makeUpload };
