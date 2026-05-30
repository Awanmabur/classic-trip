const mongoose = require("mongoose");

const WalletTxnSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: [
        "referral_credit",
        "redeem_debit",
        "redeem_restore",
        "manual_credit",
        "manual_debit",
        "promoter_commission",
        "platform_commission",
        "operator_sale_share",
        "commission_reversal",
        "payment_refund",
        "withdrawal_request",
        "payout_disbursed"
      ],
      required: true,
      index: true
    },
    amount: { type: Number, required: true }, // positive numbers; sign inferred by type
    currency: { type: String, default: "UGX" },

    // linkage
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    sourceBookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" }, // for referral credits
    note: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.models.WalletTxn || mongoose.model("WalletTxn", WalletTxnSchema);
