const mongoose = require("mongoose");

const ReviewSchema = new mongoose.Schema(
  {
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: "Route", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, trim: true }
  },
  { timestamps: true }
);

ReviewSchema.index({ routeId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("Review", ReviewSchema);
