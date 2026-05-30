const mongoose = require("mongoose");

const PartnerInviteSchema = new mongoose.Schema(
  {
    inquiryId: { type: mongoose.Schema.Types.ObjectId, ref: "PartnerInquiry", default: null, index: true },
    invitedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    acceptedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    companyName: { type: String, required: true, trim: true },
    businessType: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    contactName: { type: String, trim: true, default: "" },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    phone: { type: String, trim: true, default: "" },
    role: {
      type: String,
      enum: ["company_admin", "partner"],
      default: "company_admin",
      index: true
    },
    notes: { type: String, trim: true, default: "" },
    tokenHash: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "revoked", "expired"],
      default: "pending",
      index: true
    },
    sentAt: { type: Date, default: Date.now },
    lastSentAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PartnerInvite", PartnerInviteSchema);
