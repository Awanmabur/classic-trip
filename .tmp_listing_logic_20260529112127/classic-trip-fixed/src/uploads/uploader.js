const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("./cloudinary");

function makeUpload(folder = "classic-trip") {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: async (_req, file) => {
      const ext = (file.originalname || "").split(".").pop().toLowerCase();
      const allowed = new Set(["jpg", "jpeg", "png", "webp"]);
      if (!allowed.has(ext)) {
        const err = new Error("Only jpg/jpeg/png/webp allowed");
        err.statusCode = 400;
        throw err;
      }
      return {
        folder,
        resource_type: "image",
        format: ext
      };
    }
  });

  return multer({
    storage,
    limits: { fileSize: 3 * 1024 * 1024 } // 3MB
  });
}

module.exports = { makeUpload };
