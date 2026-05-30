const mongoose = require("mongoose");

const PartnerInquirySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    companyName: { type: String, required: true, trim: true },
    businessType: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    contactName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    phone: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["new", "reviewing", "approved", "rejected"],
      default: "new",
      index: true
    },
    inviteId: { type: mongoose.Schema.Types.ObjectId, ref: "PartnerInvite", default: null, index: true },
    reviewedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    reviewedAt: { type: Date, default: null },
    notes: { type: String, trim: true, default: "" },
    source: { type: String, trim: true, default: "public_auth" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PartnerInquiry", PartnerInquirySchema);
