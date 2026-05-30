const mongoose = require("mongoose");

const SupportRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    name: { type: String, required: true, trim: true },
    contact: { type: String, required: true, trim: true },
    topic: { type: String, required: true, trim: true },
    bookingReference: { type: String, trim: true, default: "" },
    priority: {
      type: String,
      enum: ["Normal", "High", "Urgent"],
      default: "Normal",
      index: true
    },
    message: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["new", "open", "resolved", "closed"],
      default: "new",
      index: true
    },
    source: { type: String, trim: true, default: "public_auth" },
    notes: { type: String, trim: true, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SupportRequest", SupportRequestSchema);
