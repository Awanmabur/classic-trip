const mongoose = require("mongoose");

const WalletSchema = new mongoose.Schema(
  {
    // Legacy field used by the older dashboard/wallet controllers.
    // Kept in sync with ownerId so existing code can still query by userId.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    // Current wallet ownership fields used by the shared marketplace APIs.
    ownerType: {
      type: String,
      enum: ["user", "company", "platform"],
      default: "user",
      required: true,
      index: true
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    balance: { type: Number, default: 0 },
    pendingBalance: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    currency: { type: String, default: "UGX" },
    status: { type: String, enum: ["active", "suspended"], default: "active" }
  },
  { timestamps: true }
);

WalletSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });
WalletSchema.index({ userId: 1 }, { unique: true, sparse: true });

WalletSchema.pre("validate", function syncLegacyUserId() {
  if (!this.ownerType) this.ownerType = "user";
  if (!this.ownerId && this.userId) this.ownerId = this.userId;
  if (!this.userId && this.ownerId) this.userId = this.ownerId;
});

module.exports = mongoose.models.Wallet || mongoose.model("Wallet", WalletSchema);
