const mongoose = require("mongoose");

const WalletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, required: true, index: true },
    balance: { type: Number, default: 0 }, // in smallest currency unit of currencyCode, but for now keep "normal" amount
    currency: { type: String, default: "UGX" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Wallet", WalletSchema);
