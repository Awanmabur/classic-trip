const mongoose = require("mongoose");

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    slug: { type: String, trim: true, lowercase: true, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["trial", "active", "suspended", "cancelled"],
      default: "trial",
      index: true
    },
    databaseName: { type: String, trim: true, required: true, unique: true },
    businessType: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
    currency: { type: String, trim: true, default: "UGX" },
    timezone: { type: String, trim: true, default: "Africa/Kampala" },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    ownerName: { type: String, trim: true, default: "" },
    ownerEmail: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    primaryDomain: { type: String, trim: true, lowercase: true, default: "" },
    settings: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    provisionedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Tenant", tenantSchema);
