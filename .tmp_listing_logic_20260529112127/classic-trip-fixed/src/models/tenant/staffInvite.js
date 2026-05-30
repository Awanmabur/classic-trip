const mongoose = require("mongoose");

const staffInviteSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    invitedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    acceptedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    name: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    jobTitle: { type: String, trim: true, default: "Operations staff" },
    permissionsLabel: { type: String, trim: true, default: "Operations" },
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

staffInviteSchema.index({ ownerId: 1, email: 1, status: 1 });

module.exports = { staffInviteSchema };
