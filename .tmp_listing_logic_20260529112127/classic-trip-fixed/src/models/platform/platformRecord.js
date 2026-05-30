const mongoose = require("mongoose");

const platformRecordSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true, lowercase: true, required: true, index: true },
    title: { type: String, trim: true, required: true, index: true },
    status: { type: String, trim: true, lowercase: true, default: "open", index: true },
    priority: { type: String, trim: true, lowercase: true, default: "normal", index: true },
    category: { type: String, trim: true, default: "", index: true },
    ownerName: { type: String, trim: true, default: "" },
    ownerEmail: { type: String, trim: true, lowercase: true, default: "" },
    partnerName: { type: String, trim: true, default: "" },
    channel: { type: String, trim: true, lowercase: true, default: "" },
    audience: { type: String, trim: true, default: "" },
    placement: { type: String, trim: true, default: "" },
    target: { type: String, trim: true, default: "" },
    amount: { type: Number, default: 0 },
    currency: { type: String, trim: true, uppercase: true, default: "UGX" },
    message: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    updatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    deletedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

platformRecordSchema.index({ type: 1, status: 1, deletedAt: 1, createdAt: -1 });
platformRecordSchema.index({
  title: "text",
  message: "text",
  notes: "text",
  ownerName: "text",
  partnerName: "text"
});

module.exports = mongoose.model("PlatformRecord", platformRecordSchema);
