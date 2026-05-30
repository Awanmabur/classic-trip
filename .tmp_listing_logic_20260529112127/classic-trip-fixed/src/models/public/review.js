const mongoose = require("mongoose");

const ReviewSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null, index: true },
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: "Route", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, trim: true }
  },
  { timestamps: true }
);

ReviewSchema.index({ tenantId: 1, routeId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("Review", ReviewSchema);
