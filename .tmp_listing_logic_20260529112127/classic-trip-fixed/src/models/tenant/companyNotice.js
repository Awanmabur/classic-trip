const mongoose = require("mongoose");

const companyNoticeSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", default: null, index: true },
    audience: {
      type: String,
      enum: ["customers_on_selected_trip", "all_customers_today", "staff_only"],
      default: "all_customers_today",
      index: true
    },
    priority: {
      type: String,
      enum: ["normal", "high", "urgent"],
      default: "normal",
      index: true
    },
    message: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["sent", "archived"],
      default: "sent",
      index: true
    }
  },
  { timestamps: true }
);

module.exports = { companyNoticeSchema };
