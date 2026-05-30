const mongoose = require("mongoose");

const RecoveryRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    identity: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["new", "processed"],
      default: "new",
      index: true
    },
    source: { type: String, trim: true, default: "public_auth" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("RecoveryRequest", RecoveryRequestSchema);
