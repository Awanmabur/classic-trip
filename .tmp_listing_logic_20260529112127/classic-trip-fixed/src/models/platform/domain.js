const mongoose = require("mongoose");

const domainSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    hostname: { type: String, trim: true, lowercase: true, required: true, unique: true, index: true },
    type: { type: String, enum: ["primary", "custom"], default: "custom" },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "failed"],
      default: "pending",
      index: true
    },
    verifiedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Domain", domainSchema);
