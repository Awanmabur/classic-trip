const mongoose = require("mongoose");

const companyPayoutRequestSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "UGX" },
    destination: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "paid"],
      default: "pending",
      index: true
    },
    reviewedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    reviewedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = { companyPayoutRequestSchema };
