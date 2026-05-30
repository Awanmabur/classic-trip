const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    provider: { type: String, enum: ["mock"], default: "mock", index: true },
    providerReference: { type: String, required: true, unique: true, index: true },

    amount: { type: Number, required: true },
    currency: { type: String, default: "UGX" },

    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "cancelled", "refunded"],
      default: "pending",
      index: true
    },
    checkoutUrl: { type: String, default: "" },
    failureReason: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", PaymentSchema);
